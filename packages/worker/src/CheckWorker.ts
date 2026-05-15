import {
  SQSClient,
  ReceiveMessageCommand,
  DeleteMessageCommand,
  ChangeMessageVisibilityCommand,
  type Message,
} from '@aws-sdk/client-sqs';
import { getConfig } from '@pulseway/config';
import { checkResultBatcher } from '@pulseway/db';
import { HttpChecker } from './HttpChecker.js';
import { IncidentEvaluator } from './IncidentEvaluator.js';
import { Semaphore } from './Semaphore.js';
import { getDataClient, getPubClient } from './redis.js';
import { logger, jobLogger } from './logger.js';
import { WorkerMetrics, WORKER_METRIC } from './WorkerMetrics.js';
import type { SqsCheckJob } from '@pulseway/types';

const INITIAL_BACKOFF_MS = 1_000;
const MAX_BACKOFF_MS     = 30_000;

function sleep(ms: number): Promise<void> { return new Promise((r) => setTimeout(r, ms)); }

export class CheckWorker {
  private readonly sqsClient       : SQSClient;
  private readonly httpChecker     = new HttpChecker();
  private readonly incidentEvaluator: IncidentEvaluator;
  private readonly semaphore       : Semaphore;
  private readonly metrics         : WorkerMetrics;
  private running                  = false;
  private consecutiveErrors        = 0;
  private readonly activeJobs      = new Set<Promise<void>>();

  constructor() {
    const config           = getConfig();
    this.sqsClient         = new SQSClient({ region: config.AWS_REGION, endpoint: config.AWS_ENDPOINT_URL });
    this.semaphore         = new Semaphore(config.WORKER_MAX_CONCURRENCY);
    this.incidentEvaluator = new IncidentEvaluator(getDataClient(), getPubClient());
    this.metrics           = new WorkerMetrics(getDataClient());
  }

  async start(): Promise<void> {
    this.running = true;
    await this.metrics.recordStartup();
    const config = getConfig();

    while (this.running) {
      try {
        const messages = await this.poll(config.CHECK_JOBS_QUEUE_URL);
        this.consecutiveErrors = 0;

        for (const message of messages) {
          const job = this.semaphore.run(() =>
            this.processMessage(message, config.CHECK_JOBS_QUEUE_URL),
          );
          this.activeJobs.add(job);
          job.finally(() => this.activeJobs.delete(job));
        }

        if (messages.length === 0) await sleep(config.WORKER_SQS_POLL_INTERVAL_MS);
      } catch (err) {
        this.consecutiveErrors++;
        const backoff = Math.min(INITIAL_BACKOFF_MS * 2 ** (this.consecutiveErrors - 1), MAX_BACKOFF_MS);
        logger.error({ err, backoffMs: backoff }, 'CheckWorker poll error');
        await sleep(backoff);
      }
    }
  }

  stop(): void { this.running = false; }

  async disconnect(): Promise<void> {
    await Promise.allSettled([...this.activeJobs]);
    await checkResultBatcher.drain();
    const { closeWorkerRedis } = await import('./redis.js');
    await closeWorkerRedis();
  }

  private async poll(queueUrl: string): Promise<Message[]> {
    const res = await this.sqsClient.send(new ReceiveMessageCommand({
      QueueUrl           : queueUrl,
      MaxNumberOfMessages: 10,
      WaitTimeSeconds    : 20,
      VisibilityTimeout  : 30,
    }));
    return res.Messages ?? [];
  }

  private async processMessage(message: Message, queueUrl: string): Promise<void> {
    if (!message.Body || !message.ReceiptHandle) return;

    let job: SqsCheckJob;
    try {
      job = JSON.parse(message.Body) as SqsCheckJob;
    } catch {
      logger.error({ messageId: message.MessageId }, 'Unparseable check job — discarding');
      await this.deleteMessage(queueUrl, message.ReceiptHandle);
      return;
    }

    const log = jobLogger(message.MessageId ?? 'unknown', job.monitorId);

    try {
      log.debug({ url: job.url, region: job.region }, 'Starting check');
      await this.executeCheck(job, log);
      await this.deleteMessage(queueUrl, message.ReceiptHandle);
      log.debug('Check completed');
    } catch (err) {
      log.error({ err }, 'Check execution failed');
      await this.metrics.inc(WORKER_METRIC.CHECKS_FAILED);
      await this.sqsClient.send(new ChangeMessageVisibilityCommand({
        QueueUrl         : queueUrl,
        ReceiptHandle    : message.ReceiptHandle,
        VisibilityTimeout: 0,
      })).catch(() => null);
    }
  }

  private async executeCheck(job: SqsCheckJob, log: ReturnType<typeof jobLogger>): Promise<void> {
    const result = await this.httpChecker.check({
      url               : job.url,
      httpMethod        : job.httpMethod,
      requestHeaders    : job.requestHeaders,
      expectedStatusCode: job.expectedStatusCode,
    });

    log.info({
      status        : result.status,
      responseTimeMs: result.responseTimeMs,
      statusCode    : result.statusCode,
      region        : job.region,
    }, 'Check result');

    await Promise.all([
      checkResultBatcher.enqueue({
        monitorId     : job.monitorId,
        status        : result.status,
        statusCode    : result.statusCode,
        responseTimeMs: result.responseTimeMs,
        errorMessage  : result.errorMessage,
        region        : job.region,
      }),
      getDataClient().setex(
        `monitor:${job.monitorId}:latest`,
        300,
        JSON.stringify({
          status        : result.status,
          responseTimeMs: result.responseTimeMs,
          checkedAt     : new Date().toISOString(),
          region        : job.region,
        }),
      ),
      getPubClient().publish(
        'check-events',
        JSON.stringify({
          type       : 'check:completed',
          data       : { monitorId: job.monitorId, status: result.status, responseTimeMs: result.responseTimeMs, region: job.region },
          workspaceId: job.workspaceId,
        }),
      ),
    ]);

    await this.incidentEvaluator.evaluate(job.monitorId, job.workspaceId, result.status);
    await this.metrics.inc(WORKER_METRIC.CHECKS_PROCESSED);
    if (result.status === 'down')     await this.metrics.inc(WORKER_METRIC.CHECKS_DOWN);
    if (result.status === 'degraded') await this.metrics.inc(WORKER_METRIC.CHECKS_DEGRADED);
  }

  private async deleteMessage(queueUrl: string, receiptHandle: string): Promise<void> {
    await this.sqsClient.send(new DeleteMessageCommand({ QueueUrl: queueUrl, ReceiptHandle: receiptHandle }));
  }
}
