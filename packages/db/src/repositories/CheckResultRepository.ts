import { getPool } from '../client.js';
import type { CheckResult, PercentileStats } from '@pulseway/types';

interface CheckResultRow {
  id: string; monitor_id: string; status: string; status_code: number | null;
  response_time_ms: number | null; error_message: string | null; region: string; checked_at: Date;
}

interface InsertCheckResultParams {
  monitorId: string; status: CheckResult['status']; statusCode: number | null;
  responseTimeMs: number; errorMessage: string | null; region: string;
}

export interface CursorPage<T> { items: T[]; nextCursor: string | null; }

function toCheckResult(row: CheckResultRow): CheckResult {
  return {
    id: row.id, monitorId: row.monitor_id, status: row.status as CheckResult['status'],
    statusCode: row.status_code, responseTimeMs: row.response_time_ms ?? 0,
    errorMessage: row.error_message, region: row.region, checkedAt: row.checked_at.toISOString(),
  };
}

export class CheckResultRepository {
  async insert(params: InsertCheckResultParams): Promise<CheckResult> {
    const pool = getPool();
    const { rows } = await pool.query<CheckResultRow>(
      `INSERT INTO check_results (monitor_id, status, status_code, response_time_ms, error_message, region)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [params.monitorId, params.status, params.statusCode, params.responseTimeMs, params.errorMessage, params.region],
    );
    const row = rows[0];
    if (!row) throw new Error('Insert returned no rows');
    return toCheckResult(row);
  }

  /** Cursor-based pagination — avoids OFFSET scans on large partitioned tables */
  async findByMonitorCursor(monitorId: string, limit = 50, cursor?: string): Promise<CursorPage<CheckResult>> {
    const pool = getPool();
    const safeLimit = Math.min(limit, 500);
    const { rows } = cursor
      ? await pool.query<CheckResultRow>(
          `SELECT * FROM check_results WHERE monitor_id = $1 AND checked_at < $2
           ORDER BY checked_at DESC LIMIT $3`,
          [monitorId, cursor, safeLimit],
        )
      : await pool.query<CheckResultRow>(
          `SELECT * FROM check_results WHERE monitor_id = $1
           ORDER BY checked_at DESC LIMIT $2`,
          [monitorId, safeLimit],
        );

    const items = rows.map(toCheckResult);
    const lastRow = rows[rows.length - 1];
    return { items, nextCursor: rows.length === safeLimit && lastRow ? lastRow.checked_at.toISOString() : null };
  }

  async findLatestByMonitor(monitorId: string, limit = 50): Promise<CheckResult[]> {
    const { items } = await this.findByMonitorCursor(monitorId, limit);
    return items;
  }

  async getUptimePercent(monitorId: string, days: number): Promise<number> {
    const pool = getPool();
    const { rows } = await pool.query<{ total: string; up: string }>(
      `SELECT COUNT(*) AS total, COUNT(*) FILTER (WHERE status = 'up') AS up
       FROM check_results WHERE monitor_id = $1 AND checked_at > NOW() - INTERVAL '1 day' * $2`,
      [monitorId, days],
    );
    const row = rows[0];
    if (!row || row.total === '0') return 100;
    return Math.round((parseInt(row.up, 10) / parseInt(row.total, 10)) * 10_000) / 100;
  }

  async getPercentileStats(monitorId: string, rangeHours: number): Promise<PercentileStats[]> {
    const pool = getPool();
    const { rows } = await pool.query<{ p50: number; p95: number; p99: number; bucket_start: Date }>(
      `SELECT DATE_TRUNC('hour', checked_at) AS bucket_start,
         PERCENTILE_CONT(0.50) WITHIN GROUP (ORDER BY response_time_ms) AS p50,
         PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY response_time_ms) AS p95,
         PERCENTILE_CONT(0.99) WITHIN GROUP (ORDER BY response_time_ms) AS p99
       FROM check_results WHERE monitor_id = $1 AND status = 'up'
         AND checked_at > NOW() - INTERVAL '1 hour' * $2
       GROUP BY bucket_start ORDER BY bucket_start`,
      [monitorId, rangeHours],
    );
    return rows.map((r) => ({ p50: Number(r.p50), p95: Number(r.p95), p99: Number(r.p99), bucketStart: r.bucket_start.toISOString() }));
  }
}
