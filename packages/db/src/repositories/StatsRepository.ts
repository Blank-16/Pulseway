import { getPool } from '../client.js';
import type { PercentileStats } from '@pulseway/types';

interface StatsRow {
  hour_bucket  : Date;
  total_checks : number;
  up_count     : number;
  p50_ms       : number | null;
  p75_ms       : number | null;
  p95_ms       : number | null;
  p99_ms       : number | null;
}

export class StatsRepository {
  /**
   * Returns pre-aggregated hourly stats for rangeHours.
   * Falls back to raw check_results for ranges < 2 hours (not yet rolled up).
   */
  async getPercentileStats(monitorId: string, rangeHours: number): Promise<PercentileStats[]> {
    const pool = getPool();

    if (rangeHours <= 2) {
      // Short range — query raw results directly
      const { rows } = await pool.query<{
        bucket: Date; p50: number; p75: number; p95: number; p99: number;
      }>(
        `SELECT
           date_trunc('minute', checked_at)                           AS bucket,
           PERCENTILE_CONT(0.50) WITHIN GROUP (ORDER BY response_time_ms)::INTEGER AS p50,
           PERCENTILE_CONT(0.75) WITHIN GROUP (ORDER BY response_time_ms)::INTEGER AS p75,
           PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY response_time_ms)::INTEGER AS p95,
           PERCENTILE_CONT(0.99) WITHIN GROUP (ORDER BY response_time_ms)::INTEGER AS p99
         FROM check_results
         WHERE monitor_id = $1 AND checked_at >= NOW() - ($2 || ' hours')::INTERVAL
         GROUP BY date_trunc('minute', checked_at)
         ORDER BY bucket`,
        [monitorId, rangeHours],
      );
      return rows.map((r) => ({
        bucket: r.bucket.toISOString(),
        p50: r.p50 ?? 0, p75: r.p75 ?? 0, p95: r.p95 ?? 0, p99: r.p99 ?? 0,
      }));
    }

    // Use pre-aggregated hourly table — O(rangeHours) not O(check_count)
    const { rows } = await pool.query<StatsRow>(
      `SELECT *
       FROM monitor_stats_hourly
       WHERE monitor_id = $1 AND hour_bucket >= NOW() - ($2 || ' hours')::INTERVAL
       ORDER BY hour_bucket`,
      [monitorId, rangeHours],
    );

    return rows.map((r) => ({
      bucket: r.hour_bucket.toISOString(),
      p50   : r.p50_ms ?? 0,
      p75   : r.p75_ms ?? 0,
      p95   : r.p95_ms ?? 0,
      p99   : r.p99_ms ?? 0,
    }));
  }

  async getUptimePercent(monitorId: string, days: number): Promise<number> {
    const pool = getPool();
    const { rows } = await pool.query<{ uptime: string }>(
      `SELECT
         ROUND(
           100.0 * SUM(up_count) / NULLIF(SUM(total_checks), 0),
           4
         ) AS uptime
       FROM monitor_stats_hourly
       WHERE monitor_id = $1 AND hour_bucket >= NOW() - ($2 || ' days')::INTERVAL`,
      [monitorId, days],
    );
    return parseFloat(rows[0]?.uptime ?? '100');
  }

  /**
   * Batch uptime query — single SQL call for all monitor IDs.
   * Returns a Map<monitorId, uptimePercent>.
   */
  async getUptimePercentBatch(monitorIds: string[], days: number): Promise<Map<string, number>> {
    if (monitorIds.length === 0) return new Map();
    const pool = getPool();
    const { rows } = await pool.query<{ monitor_id: string; uptime: string }>(
      `SELECT
         monitor_id,
         ROUND(100.0 * SUM(up_count) / NULLIF(SUM(total_checks), 0), 4) AS uptime
       FROM monitor_stats_hourly
       WHERE monitor_id = ANY($1::uuid[])
         AND hour_bucket >= NOW() - ($2 || ' days')::INTERVAL
       GROUP BY monitor_id`,
      [monitorIds, days],
    );
    const result = new Map<string, number>();
    // Pre-fill 100% for monitors with no data (no checks = never failed)
    for (const id of monitorIds) result.set(id, 100);
    for (const row of rows) result.set(row.monitor_id, parseFloat(row.uptime ?? '100'));
    return result;
  }


}
