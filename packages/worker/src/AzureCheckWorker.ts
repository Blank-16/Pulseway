import { getConfig } from '@pulseway/config';
import { checkResultBatcher } from '@pulseway/db';
import { HttpChecker } from './HttpChecker.js';
import { IncidentEvaluator } from './IncidentEvaluator.js';
import { Semaphore } from './Semaphore.js';
import { getDataClient, getPubClient } from './redis.js';
import { logger, jobLogger } from './logger.js';
import { WorkerMetrics, WORKER_METRIC } from './WorkerMetrics.js';
import { extractTraceContext } from './telemetry.js';
import { ServiceBusAdapter, type QueueMessage } from './queue/ServiceBusAdapter.js';
import { context as otelContext } from '@opentelemetry/api';
import type { SqsCheckJob } from '@pulseway/types';

const INITIAL_BACKOFF_MS = 1_000;
const MAX_BACKOFF_MS     = 30_000;

function sleep(ms: number): Promise<void> { return new Promise((r) => setTimeout(r, ms)); }

/**
 * Azure-specific CheckWorker that receives messages from Azure Service Bus
 * instead of SQS. Business logic is identical to CheckWorker.
 */
export class AzureCheckWorker {
  private readonly adapter           : ServiceBusAdapter;
  private readonly httpChecker       = new HttpChecker();
  private readonly incidentEvaluator : IncidentEvaluator;
  private readonly semaphore         : Semaphore;
  private readonly metrics           : WorkerMetrics;
  private running                    = false;
  private consecutiveErrors          = 0;
  private readonly activeJobs        = new Set<Promise<void>>();

  constructor() {
    const config           = getConfig();
    this.adapter           = new ServiceBusAdapter(config.AZURE_SERVICEBUS_CHECK_CONN_STR!);
    this.semaphore         = new Semaphore(config.WORKER_MAX_CONCURRENCY);
    this.incidentEvaluator = new IncidentEvaluator(getDataClient(), getPubClient());
    this.metrics           = new WorkerMetrics(getDataClient());
  }

  async start(): Promise<void> {
    this.running = true;
    await this.metrics.recordStartup();
    logger.info({ cloud: 'azure' }, 'AzureCheckWorker started');

    while (this.running) {
      try {
        const messages = await this.adapter.receiveMessages('check-jobs', 10);
        this.consecutiveErrors = 0;

        for (const message of messages) {
          const job = this.semaphore.run(() =>
            this.processMessage(message),
          );
          this.activeJobs.add(job);
          job.finally(() => this.activeJobs.delete(job));
        }

        if (messages.length === 0) await sleep(getConfig().WORKER_SQS_POLL_INTERVAL_MS);
      } catch (err) {
        this.consecutiveErrors++;
        const backoff = Math.min(INITIAL_BACKOFF_MS * 2 ** (this.consecutiveErrors - 1), MAX_BACKOFF_MS);
        logger.error({ err, backoffMs: backoff }, 'AzureCheckWorker poll error');
        await sleep(backoff);
      }
    }
  }

  stop(): void { this.running = false; }

  async disconnect(): Promise<void> {
    await Promise.allSettled([...this.activeJobs]);
    await checkResultBatcher.drain();
    await this.adapter.close();
  }

  private async processMessage(message: QueueMessage): Promise<void> {
    let job: SqsCheckJob;
    try {
      job = JSON.parse(message.body) as SqsCheckJob;
    } catch {
      logger.error({ messageId: message.messageId }, 'Unparseable check job — discarding');
      await this.adapter.deleteMessage('check-jobs', message.receiptHandle);
      return;
    }

    const log = jobLogger(message.messageId ?? 'unknown', job.monitorId);

    try {
      if (job.region !== getConfig().WORKER_REGION) {
        log.debug({ jobRegion: job.region }, 'Skipping — wrong region');
        await this.adapter.abandonMessage('check-jobs', message.receiptHandle);
        return;
      }

      log.debug({ url: job.url, region: job.region }, 'Starting check');
      await otelContext.with(extractTraceContext({}), () => this.executeCheck(job, log));
      await this.adapter.deleteMessage('check-jobs', message.receiptHandle);
      log.debug('Check completed');
    } catch (err) {
      log.error({ err }, 'Check execution failed');
      await this.metrics.inc(WORKER_METRIC.CHECKS_FAILED);
      await this.adapter.abandonMessage('check-jobs', message.receiptHandle);
    }
  }

  private async executeCheck(job: SqsCheckJob, log: ReturnType<typeof jobLogger>): Promise<void> {
    const result = await this.httpChecker.check({
      url               : job.url,
      httpMethod        : job.httpMethod,
      requestHeaders    : job.requestHeaders,
      expectedStatusCode: job.expectedStatusCode,
      bodyContains      : job.bodyContains,
      bodyJsonPath      : job.bodyJsonPath,
      bodyJsonValue     : job.bodyJsonValue,
    });

    log.info({ status: result.status, responseTimeMs: result.responseTimeMs, region: job.region }, 'Check result');

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
        `monitor:${job.monitorId}:latest`, 300,
        JSON.stringify({ status: result.status, responseTimeMs: result.responseTimeMs, checkedAt: new Date().toISOString(), region: job.region }),
      ),
      getPubClient().publish('check-events', JSON.stringify({
        type: 'check:completed',
        data: { monitorId: job.monitorId, status: result.status, responseTimeMs: result.responseTimeMs, region: job.region },
        workspaceId: job.workspaceId,
      })),
    ]);

    await this.incidentEvaluator.evaluate(job.monitorId, job.workspaceId, result.status);
    await this.metrics.inc(WORKER_METRIC.CHECKS_PROCESSED);
    if (result.status === 'down')     await this.metrics.inc(WORKER_METRIC.CHECKS_DOWN);
    if (result.status === 'degraded') await this.metrics.inc(WORKER_METRIC.CHECKS_DEGRADED);
  }
}
