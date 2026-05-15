import Redis from 'ioredis';
import { getConfig } from '@pulseway/config';
import { MonitorRepository } from '@pulseway/db';
import {
  SQSClient,
  SendMessageBatchCommand,
  type SendMessageBatchRequestEntry,
} from '@aws-sdk/client-sqs';
import type { Monitor, SqsCheckJob } from '@pulseway/types';

const LOCK_KEY    = 'scheduler:lock';
const LOCK_TTL_MS = 15_000;
// Max concurrent SQS batch sends — prevents overwhelming the SQS endpoint
// at startup when many monitors are due simultaneously
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
  const queue = [...items];
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (queue.length > 0) {
      const item = queue.shift()!;
      await fn(item);
    }
  });
  await Promise.all(workers);
}

export class SchedulerLoop {
  private readonly sqsClient   : SQSClient;
  private readonly redis       : Redis;
  private readonly monitorRepo = new MonitorRepository();
  private running              = false;
  private readonly lockValue   = `${process.pid}-${Date.now()}`;

  constructor() {
    const config     = getConfig();
    this.sqsClient   = new SQSClient({ region: config.AWS_REGION, endpoint: config.AWS_ENDPOINT_URL });
    this.redis       = new Redis(config.REDIS_URL, {
      lazyConnect      : false,
      maxRetriesPerRequest: 3,
      connectionName   : 'pulseway-scheduler',
      retryStrategy    : (t) => Math.min(t * 200, 10_000),
    });
    this.redis.on('error', (err) => console.error('[Scheduler Redis]', err));
  }

  async start(): Promise<void> {
    this.running = true;
    const config = getConfig();
    console.info('Scheduler started');

    while (this.running) {
      const startTime = Date.now();
      try {
        await this.tick();
      } catch (err) {
        console.error('Scheduler tick error:', err);
      }
      const remaining = config.SCHEDULER_POLL_INTERVAL_MS - (Date.now() - startTime);
      if (remaining > 0) await sleep(remaining);
    }
  }

  stop(): void { this.running = false; }

  async disconnect(): Promise<void> { await this.redis.quit(); }

  private async tick(): Promise<void> {
    const acquired = await this.redis.set(LOCK_KEY, this.lockValue, 'NX', 'PX', LOCK_TTL_MS);
    if (!acquired) return;

    try {
      const dueMonitors = await this.monitorRepo.findDue();
      if (dueMonitors.length === 0) return;

      console.info(`Scheduler: ${dueMonitors.length} monitors due`);

      await this.monitorRepo.updateLastCheckedAt(dueMonitors.map((m) => m.id));
      // Rate-limit concurrent SQS calls to avoid per-second burst throttling
      await pLimit(dueMonitors, ENQUEUE_CONCURRENCY, (m) => this.enqueueChecks(m));
    } finally {
      const current = await this.redis.get(LOCK_KEY);
      if (current === this.lockValue) await this.redis.del(LOCK_KEY);
    }
  }

  private async enqueueChecks(monitor: Monitor): Promise<void> {
    const config = getConfig();
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
      };
      return {
        Id                     : `${monitor.id.replace(/-/g, '')}-${region.replace(/-/g, '')}`,
        MessageBody            : JSON.stringify(job),
        MessageGroupId         : monitor.workspaceId,
        MessageDeduplicationId : `${monitor.id}-${region}-${Date.now()}`,
      };
    });

    await Promise.all(
      chunk(entries, 10).map((batch) =>
        this.sqsClient.send(new SendMessageBatchCommand({ QueueUrl: config.CHECK_JOBS_QUEUE_URL, Entries: batch })),
      ),
    );
  }
}
