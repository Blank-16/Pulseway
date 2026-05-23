#!/usr/bin/env tsx
/**
 * Creates next 3 months of check_results partitions.
 * Schedule via cron (1st of each month) or AWS EventBridge.
 */
import { loadConfig } from '@pulseway/config';
import { getPool, closePool } from '@pulseway/db';

async function ensurePartitions(): Promise<void> {
  await loadConfig();
  const pool = getPool();

  const now = new Date();
  for (let monthOffset = 0; monthOffset <= 2; monthOffset++) {
    const start  = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + monthOffset, 1));
    const end    = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1));
    const suffix = `${start.getUTCFullYear()}_${String(start.getUTCMonth() + 1).padStart(2, '0')}`;
    const name   = `check_results_${suffix}`;

    const { rows } = await pool.query<{ exists: boolean }>(
      `SELECT EXISTS (
         SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = $1
       ) AS exists`,
      [name],
    );

    if (rows[0]?.exists) {
      console.log(`Partition ${name} already exists — skipping`);
      continue;
    }

    const sql = `
      CREATE TABLE IF NOT EXISTS ${name}
        PARTITION OF check_results
        FOR VALUES FROM ('${start.toISOString()}') TO ('${end.toISOString()}');
      CREATE INDEX IF NOT EXISTS idx_${name}_monitor_checked
        ON ${name}(monitor_id, checked_at DESC);
    `;

    await pool.query(sql);
    console.log(`Created partition: ${name} (${start.toISOString()} → ${end.toISOString()})`);
  }
}

ensurePartitions()
  .then(() => closePool())
  .then(() => process.exit(0))
  .catch((err) => { console.error('Maintenance failed:', err); process.exit(1); });
