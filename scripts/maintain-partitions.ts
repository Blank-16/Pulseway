#!/usr/bin/env tsx
/**
 * Run monthly via AWS EventBridge Scheduler or cron.
 * Creates the next 2 monthly partitions for check_results so there's
 * always future partitions available before the boundary is crossed.
 */
import { loadConfig } from '@pulseway/config';
import { getPool, closePool } from '@pulseway/db';

async function createPartitionsIfNeeded(): Promise<void> {
  await loadConfig();
  const pool = getPool();

  const now = new Date();

  for (let monthOffset = 1; monthOffset <= 2; monthOffset++) {
    const target = new Date(now.getFullYear(), now.getMonth() + monthOffset, 1);
    const next = new Date(now.getFullYear(), now.getMonth() + monthOffset + 1, 1);

    const year = target.getFullYear();
    const month = String(target.getMonth() + 1).padStart(2, '0');
    const nextYear = next.getFullYear();
    const nextMonth = String(next.getMonth() + 1).padStart(2, '0');

    const partitionName = `check_results_${year}_${month}`;
    const fromVal = `${year}-${month}-01`;
    const toVal = `${nextYear}-${nextMonth}-01`;

    const existing = await pool.query<{ count: string }>(
      `SELECT COUNT(*) AS count FROM pg_class WHERE relname = $1`,
      [partitionName],
    );

    if (existing.rows[0]?.count === '0') {
      await pool.query(
        `CREATE TABLE IF NOT EXISTS ${partitionName} PARTITION OF check_results
         FOR VALUES FROM ('${fromVal}') TO ('${toVal}')`,
      );
      console.log(`Created partition: ${partitionName}`);
    } else {
      console.log(`Partition already exists: ${partitionName}`);
    }
  }
}

createPartitionsIfNeeded()
  .then(() => closePool())
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Partition maintenance failed:', err);
    process.exit(1);
  });
