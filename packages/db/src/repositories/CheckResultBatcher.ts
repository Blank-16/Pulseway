import { getPool } from '../client.js';

interface CheckResultInput {
  monitorId: string;
  status: string;
  statusCode: number | null;
  responseTimeMs: number;
  errorMessage: string | null;
  region: string;
}

interface PendingItem {
  row: CheckResultInput;
  resolve: () => void;
  reject: (err: unknown) => void;
}

const FLUSH_INTERVAL_MS = 200;
const MAX_BATCH_SIZE    = 100;

class CheckResultBatcher {
  private queue: PendingItem[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  private inFlight: Set<Promise<void>> = new Set();
  private draining = false;

  enqueue(row: CheckResultInput): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      this.queue.push({ row, resolve, reject });
      if (this.queue.length >= MAX_BATCH_SIZE) {
        this.scheduleFlush(true);
      } else if (!this.timer) {
        this.timer = setTimeout(() => this.scheduleFlush(false), FLUSH_INTERVAL_MS);
      }
    });
  }

  // Waits for all in-flight inserts to settle — safe to call on shutdown.
  async drain(): Promise<void> {
    this.draining = true;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    // Flush whatever remains in the queue synchronously
    if (this.queue.length > 0) {
      const p = this.doInsert(this.queue.splice(0));
      this.inFlight.add(p);
      p.finally(() => this.inFlight.delete(p));
    }
    // Await every in-flight promise, ignoring individual errors (already handled per-item)
    await Promise.allSettled([...this.inFlight]);
    this.draining = false;
  }

  private scheduleFlush(immediate: boolean): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (immediate) {
      const batch = this.queue.splice(0, MAX_BATCH_SIZE);
      if (batch.length === 0) return;
      const p = this.doInsert(batch);
      this.inFlight.add(p);
      p.finally(() => this.inFlight.delete(p));
    } else {
      // Flush all remaining in one batch
      const batch = this.queue.splice(0);
      if (batch.length === 0) return;
      const p = this.doInsert(batch);
      this.inFlight.add(p);
      p.finally(() => this.inFlight.delete(p));
    }
  }

  private async doInsert(batch: PendingItem[]): Promise<void> {
    if (batch.length === 0) return;
    const pool = getPool();

    // Build parameterized multi-row INSERT
    const values: unknown[] = [];
    const placeholders = batch.map((item, i) => {
      const base = i * 6;
      values.push(
        item.row.monitorId,
        item.row.status,
        item.row.statusCode,
        item.row.responseTimeMs,
        item.row.errorMessage,
        item.row.region,
      );
      return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, NOW())`;
    });

    const sql = `
      INSERT INTO check_results (monitor_id, status, status_code, response_time_ms, error_message, region, checked_at)
      VALUES ${placeholders.join(', ')}
      RETURNING id, monitor_id
    `;

    try {
      const { rows } = await pool.query<{ id: string; monitor_id: string }>(sql, values);

      // Match returned rows to pending items by monitor_id+position
      // Build a per-monitor queue to preserve insertion order
      const byMonitor = new Map<string, string[]>();
      for (const row of rows) {
        const list = byMonitor.get(row.monitor_id) ?? [];
        list.push(row.id);
        byMonitor.set(row.monitor_id, list);
      }
      const monitorCursors = new Map<string, number>();

      for (const item of batch) {
        const mid = item.row.monitorId;
        const cursor = monitorCursors.get(mid) ?? 0;
        const idList = byMonitor.get(mid);
        if (idList && cursor < idList.length) {
          monitorCursors.set(mid, cursor + 1);
          item.resolve();
        } else {
          // Row was inserted (batch succeeded) but we couldn't correlate — still resolve
          item.resolve();
        }
      }
    } catch (err) {
      for (const item of batch) item.reject(err);
    }
  }
}

export const checkResultBatcher = new CheckResultBatcher();
