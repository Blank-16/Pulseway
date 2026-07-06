import Redis from 'ioredis';
import { getConfig, ServiceBusSender, injectTraceContext } from '@pulseway/config';
import { MonitorRepository } from '@pulseway/db';
import {
  SQSClient,
  SendMessageBatchCommand,
  type SendMessageBatchRequestEntry,
} from '@aws-sdk/client-sqs';
import type { Monitor, SqsCheckJob } from '@pulseway/types';
import { recordSchedulerTick } from './metrics.js';
import { logger } from './logger.js';

const LOCK_KEY         = 'scheduler:lock';
const LOCK_TTL_MS      = 15_000;
const ENQUEUE_CONCURRENCY = 20;

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function sleep(ms: number): Promise<void> { return new Promise((r) => setTimeout(r, ms)); }

async function pLimit<T>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<void>,
): Promise<void> {
  const queue   = [...items];
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (queue.length > 0) {
      const item = queue.shift()!;
      await fn(item);
    }
  });
  await Promise.all(workers);
}

export class SchedulerLoop {
  private readonly sqsClient  : SQSClient;
  private readonly redis      : Redis;
  private readonly monitorRepo = new MonitorRepository();
  private running              = false;
  private readonly lockValue   = `${process.pid}-${Date.now()}`;

  constructor() {
    const config   = getConfig();
    this.sqsClient = new SQSClient({ region: config.AWS_REGION, endpoint: config.AWS_ENDPOINT_URL } as any);
    this.redis     = new Redis(config.REDIS_URL, {
      lazyConnect         : false,
      maxRetriesPerRequest: 3,
      connectionName      : 'pulseway-scheduler',
      retryStrategy       : (attempt) => Math.min(attempt * 200, 10_000),
    });
    this.redis.on('error', (err) =>
      logger.error({ err }, '[Scheduler Redis] connection error'),
    );
  }

  async start(): Promise<void> {
    this.running = true;
    const config = getConfig();
    logger.info({ cloud: config.CLOUD, region: config.WORKER_REGION }, 'Scheduler started');

    while (this.running) {
      const startTime = Date.now();
      try {
        await this.tick();
      } catch (err) {
        logger.error({ err }, 'Scheduler tick error');
      }
      const elapsed   = Date.now() - startTime;
      const remaining = config.SCHEDULER_POLL_INTERVAL_MS - elapsed;
      if (remaining > 0) await sleep(remaining);
    }
  }

  stop(): void { this.running = false; }

  async disconnect(): Promise<void> { await this.redis.quit(); }

  private async tick(): Promise<void> {
    const acquired = await this.redis.set(LOCK_KEY, this.lockValue, 'PX', LOCK_TTL_MS, 'NX');
    if (!acquired) return;

    try {
      const dueMonitors = await this.monitorRepo.findDue();
      if (dueMonitors.length === 0) return;

      logger.info({ count: dueMonitors.length }, 'Monitors due for check');

      await this.monitorRepo.updateLastCheckedAt(dueMonitors.map((m) => m.id));
      await pLimit(dueMonitors, ENQUEUE_CONCURRENCY, (m) => this.enqueueChecks(m));
      await recordSchedulerTick(this.redis);
    } finally {
      // Verify lock ownership before release — prevents releasing a lock we don't own
      // (possible if the lock TTL expired and another instance acquired it)
      const current = await this.redis.get(LOCK_KEY);
      if (current === this.lockValue) await this.redis.del(LOCK_KEY);
    }
  }

  private async enqueueChecks(monitor: Monitor): Promise<void> {
    const config = getConfig();

    if (config.CLOUD === 'azure') {
      await this.enqueueChecksAzure(monitor, config);
      return;
    }

    await this.enqueueChecksSQS(monitor, config);
  }

  private async enqueueChecksSQS(monitor: Monitor, config: ReturnType<typeof getConfig>): Promise<void> {
    if (!config.CHECK_JOBS_QUEUE_URL) {
      throw new Error('CHECK_JOBS_QUEUE_URL is required when CLOUD=aws');
    }

    const entries: SendMessageBatchRequestEntry[] = monitor.regionCodes.map((region) => {
      const job: SqsCheckJob = {
        monitorId          : monitor.id,
        workspaceId        : monitor.workspaceId,
        url                : monitor.url,
        httpMethod         : monitor.httpMethod,
        requestHeaders     : monitor.requestHeaders,
        expectedStatusCode : monitor.expectedStatusCode,
        region,
        enqueuedAt         : new Date().toISOString(),
        bodyContains       : monitor.bodyContains  ?? undefined,
        bodyJsonPath       : monitor.bodyJsonPath   ?? undefined,
        bodyJsonValue      : monitor.bodyJsonValue  ?? undefined,
      };
      return {
        Id                    : `${monitor.id.replace(/-/g, '')}-${region.replace(/-/g, '')}`,
        MessageBody           : JSON.stringify(job),
        MessageGroupId        : monitor.workspaceId,
        MessageDeduplicationId: `${monitor.id}-${region}-${Date.now()}`,
        MessageAttributes     : injectTraceContext(),
      };
    });

    const results = await Promise.allSettled(
      chunk(entries, 10).map((batch) =>
        this.sqsClient.send(
          new SendMessageBatchCommand({ QueueUrl: config.CHECK_JOBS_QUEUE_URL!, Entries: batch }),
        ),
      ),
    );

    const failed = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
    if (failed.length > 0) {
      throw new Error(`SQS batch send: ${failed.length}/${results.length} batches failed for monitor ${monitor.id}`);
    }
  }

  private async enqueueChecksAzure(monitor: Monitor, config: ReturnType<typeof getConfig>): Promise<void> {
    if (!config.AZURE_SERVICEBUS_CHECK_CONN_STR) {
      throw new Error('AZURE_SERVICEBUS_CHECK_CONN_STR is required when CLOUD=azure');
    }

    const sender = new ServiceBusSender(config.AZURE_SERVICEBUS_CHECK_CONN_STR);
    try {
      await Promise.all(
        monitor.regionCodes.map((region) => {
          const job: SqsCheckJob = {
            monitorId          : monitor.id,
            workspaceId        : monitor.workspaceId,
            url                : monitor.url,
            httpMethod         : monitor.httpMethod,
            requestHeaders     : monitor.requestHeaders,
            expectedStatusCode : monitor.expectedStatusCode,
            region,
            enqueuedAt         : new Date().toISOString(),
            bodyContains       : monitor.bodyContains  ?? undefined,
            bodyJsonPath       : monitor.bodyJsonPath   ?? undefined,
            bodyJsonValue      : monitor.bodyJsonValue  ?? undefined,
          };
          return sender.sendMessage('check-jobs', JSON.stringify(job));
        }),
      );
    } finally {
      await sender.close();
    }
  }
}
