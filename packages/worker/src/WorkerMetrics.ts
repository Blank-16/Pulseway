import type Redis from 'ioredis';

// Two separate hashes: counters (INCR) and last-update timestamps (SET)
// This allows stale detection per metric without waiting for the hash TTL to expire
const COUNTER_HASH       = 'metrics:worker:counts';
const TS_HASH            = 'metrics:worker:updated_at';
const HASH_TTL_SECONDS   = 3_600;
const STALE_AFTER_SECONDS = 120;

export const WORKER_METRIC = {
  CHECKS_PROCESSED  : 'checks_processed',
  CHECKS_FAILED     : 'checks_failed',
  CHECKS_DOWN       : 'checks_down',
  CHECKS_DEGRADED   : 'checks_degraded',
  INCIDENTS_OPENED  : 'incidents_opened',
  INCIDENTS_RESOLVED: 'incidents_resolved',
  ALERTS_SENT       : 'alerts_sent',
  ALERTS_FAILED     : 'alerts_failed',
} as const;

export type WorkerMetricKey = typeof WORKER_METRIC[keyof typeof WORKER_METRIC];

export class WorkerMetrics {
  constructor(private readonly redis: Redis) {}

  /**
   * Atomically increments a counter and records the current Unix timestamp for
   * stale detection. All four commands execute in one pipeline round-trip.
   */
  async inc(field: WorkerMetricKey, amount = 1): Promise<void> {
    try {
      const now      = Math.floor(Date.now() / 1000).toString();
      const pipeline = this.redis.pipeline();
      pipeline.hincrby(COUNTER_HASH, field, amount);
      pipeline.hset(TS_HASH, field, now);
      pipeline.expire(COUNTER_HASH, HASH_TTL_SECONDS);
      pipeline.expire(TS_HASH, HASH_TTL_SECONDS);
      const results = await pipeline.exec();

      // exec() returns null if the pipeline was aborted (WATCH/MULTI failure)
      if (!results) {
        throw new Error('Pipeline exec returned null — possible WATCH abort');
      }

      // Check each command's result for errors
      for (const [err] of results) {
        if (err) throw err;
      }
    } catch (err) {
      // Non-fatal — worker continues operating; metrics may be inaccurate
      // but the check pipeline must never be blocked by a metrics failure
    }
  }

  /**
   * Records the worker startup timestamp in the TS hash.
   * Used by the metrics endpoint to show when the last worker restart occurred.
   */
  async recordStartup(): Promise<void> {
    try {
      const now = Math.floor(Date.now() / 1000).toString();
      await this.redis.hset(TS_HASH, 'worker_started_at', now);
      await this.redis.expire(TS_HASH, HASH_TTL_SECONDS);
    } catch (err) {
      // Non-fatal
    }
  }

  /**
   * Returns all counter values with per-field staleness flags.
   * A counter is stale if no update has been received in STALE_AFTER_SECONDS.
   */
  async getAll(): Promise<Record<string, { value: number; stale: boolean }>> {
    try {
      const [counts, timestamps] = await Promise.all([
        this.redis.hgetall(COUNTER_HASH),
        this.redis.hgetall(TS_HASH),
      ]);
      const now = Math.floor(Date.now() / 1000);

      return Object.fromEntries(
        Object.entries(counts ?? {}).map(([k, v]) => {
          const parsed    = parseInt(v, 10);
          const value     = isNaN(parsed) ? 0 : parsed;
          const updatedAt = parseInt(timestamps?.[k] ?? '0', 10);
          const stale     = now - updatedAt > STALE_AFTER_SECONDS;
          return [k, { value, stale }];
        }),
      );
    } catch {
      return {};
    }
  }
}
