import type Redis from 'ioredis';

const HASH_KEY    = 'metrics:worker';
// TTL is per-field via a separate timestamp hash so stale counters are detectable
const COUNTER_HASH = 'metrics:worker:counts';
const TS_HASH      = 'metrics:worker:updated_at';
const STALE_AFTER_SECONDS = 120;

export class WorkerMetrics {
  constructor(private readonly redis: Redis) {}

  async inc(field: string, amount = 1): Promise<void> {
    try {
      const now = Math.floor(Date.now() / 1000).toString();
      await this.redis
        .pipeline()
        .hincrby(COUNTER_HASH, field, amount)
        .hset(TS_HASH, field, now)
        // Hash-level TTL is a safety net; field-level timestamps in TS_HASH let
        // the metrics endpoint mark individual counters stale without waiting for expiry
        .expire(COUNTER_HASH, 3600)
        .expire(TS_HASH, 3600)
        .exec();
    } catch {
      // Non-fatal
    }
  }

  /**
   * Called once at worker startup to reset counters for this process.
   * Individual worker instances share the same Redis key — counters are
   * cumulative across all running instances (desired for aggregated Prometheus).
   * Reset is intentionally NOT called here; counters accumulate until Redis TTL.
   */
  async recordStartup(): Promise<void> {
    try {
      const now = Math.floor(Date.now() / 1000).toString();
      await this.redis.hset(TS_HASH, 'worker_started_at', now);
    } catch {
      // Non-fatal
    }
  }

  async getAll(): Promise<Record<string, { value: number; stale: boolean }>> {
    try {
      const [counts, timestamps] = await Promise.all([
        this.redis.hgetall(COUNTER_HASH),
        this.redis.hgetall(TS_HASH),
      ]);
      const now = Math.floor(Date.now() / 1000);
      return Object.fromEntries(
        Object.entries(counts).map(([k, v]) => {
          const updatedAt = parseInt(timestamps[k] ?? '0', 10);
          return [k, { value: parseInt(v, 10), stale: now - updatedAt > STALE_AFTER_SECONDS }];
        }),
      );
    } catch {
      return {};
    }
  }
}

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
