import { getPool } from '../client.js';
import type { CheckResult } from '@pulseway/types';

interface InsertParams {
  monitorId: string;
  status: CheckResult['status'];
  statusCode: number | null;
  responseTimeMs: number;
  errorMessage: string | null;
  region: string;
}

type Resolve = (value: CheckResult) => void;
type Reject  = (reason: unknown) => void;

interface Pending {
  params  : InsertParams;
  resolve : Resolve;
  reject  : Reject;
}

const FLUSH_INTERVAL_MS = 200;
const FLUSH_BATCH_SIZE  = 50;

/**
 * Buffers check_result inserts and issues a single multi-row INSERT every
 * FLUSH_INTERVAL_MS or when FLUSH_BATCH_SIZE rows accumulate — whichever
 * comes first.  At 10 concurrent workers × 10 msgs/poll this cuts round-trips
 * from ~100/s down to ~5/s.
 */
export class CheckResultBatcher {
  private readonly pending: Pending[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;

  enqueue(params: InsertParams): Promise<CheckResult> {
    return new Promise<CheckResult>((resolve, reject) => {
      this.pending.push({ params, resolve, reject });
      if (this.pending.length >= FLUSH_BATCH_SIZE) {
        this.flush();
      } else if (!this.timer) {
        this.timer = setTimeout(() => this.flush(), FLUSH_INTERVAL_MS);
      }
    });
  }

  private flush(): void {
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    if (this.pending.length === 0) return;

    const batch = this.pending.splice(0, FLUSH_BATCH_SIZE);
    this.doInsert(batch).catch((err) => {
      for (const { reject } of batch) reject(err);
    });
  }

  private async doInsert(batch: Pending[]): Promise<void> {
    const pool   = getPool();
    const values : unknown[] = [];
    const placeholders: string[] = [];

    batch.forEach(({ params }, i) => {
      const base = i * 6;
      placeholders.push(`($${base+1},$${base+2},$${base+3},$${base+4},$${base+5},$${base+6})`);
      values.push(
        params.monitorId,
        params.status,
        params.statusCode,
        params.responseTimeMs,
        params.errorMessage,
        params.region,
      );
    });

    const { rows } = await pool.query<{
      id: string; monitor_id: string; status: string; status_code: number | null;
      response_time_ms: number | null; error_message: string | null; region: string; checked_at: Date;
    }>(
      `INSERT INTO check_results (monitor_id, status, status_code, response_time_ms, error_message, region)
       VALUES ${placeholders.join(',')}
       RETURNING *`,
      values,
    );

    rows.forEach((row, i) => {
      const pending = batch[i];
      if (!pending) return;
      pending.resolve({
        id            : row.id,
        monitorId     : row.monitor_id,
        status        : row.status as CheckResult['status'],
        statusCode    : row.status_code,
        responseTimeMs: row.response_time_ms ?? 0,
        errorMessage  : row.error_message,
        region        : row.region,
        checkedAt     : row.checked_at.toISOString(),
      });
    });
  }

  /** Call on shutdown to flush any remaining buffered rows */
  async drain(): Promise<void> {
    this.flush();
    // Wait for any in-flight doInsert to settle
    await new Promise<void>((resolve) => setTimeout(resolve, FLUSH_INTERVAL_MS + 50));
  }
}

// Process-level singleton — shared across all CheckWorker instances in the same process
export const checkResultBatcher = new CheckResultBatcher();
