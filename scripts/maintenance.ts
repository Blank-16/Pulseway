#!/usr/bin/env tsx
/**
 * Run monthly via EventBridge Scheduler.
 * Deletes expired/revoked refresh tokens and pre-creates upcoming partitions.
 */
import { loadConfig } from '@pulseway/config';
import { getPool, closePool } from '@pulseway/db';

async function runMaintenance(): Promise<void> {
  await loadConfig();
  const pool = getPool();

  console.info('Running maintenance...');

  // Prune expired/revoked refresh tokens
  const { rowCount: pruned } = await pool.query('SELECT prune_expired_refresh_tokens()');
  console.info(`Pruned refresh tokens`);

  // Pre-create next 2 check_results partitions
  const now = new Date();
  for (let offset = 1; offset <= 2; offset++) {
    const target = new Date(now.getFullYear(), now.getMonth() + offset, 1);
    const next   = new Date(now.getFullYear(), now.getMonth() + offset + 1, 1);
    const year   = target.getFullYear();
    const month  = String(target.getMonth() + 1).padStart(2, '0');
    const ny     = next.getFullYear();
    const nm     = String(next.getMonth() + 1).padStart(2, '0');
    const name   = `check_results_${year}_${month}`;

    const { rows } = await pool.query<{ count: string }>(
      `SELECT COUNT(*) AS count FROM pg_class WHERE relname = $1`, [name],
    );
    if (rows[0]?.count === '0') {
      await pool.query(
        `CREATE TABLE IF NOT EXISTS ${name} PARTITION OF check_results
         FOR VALUES FROM ('${year}-${month}-01') TO ('${ny}-${nm}-01')`,
      );
      console.info(`Created partition: ${name}`);
    }
  }

  // Drop partitions older than 13 months
  const cutoff = new Date(now.getFullYear(), now.getMonth() - 13, 1);
  const cy = cutoff.getFullYear();
  const cm = String(cutoff.getMonth() + 1).padStart(2, '0');
  const oldName = `check_results_${cy}_${cm}`;

  const { rows: oldRows } = await pool.query<{ count: string }>(
    `SELECT COUNT(*) AS count FROM pg_class WHERE relname = $1`, [oldName],
  );
  if ((oldRows[0]?.count ?? '0') !== '0') {
    await pool.query(`DROP TABLE IF EXISTS ${oldName}`);
    console.info(`Dropped old partition: ${oldName}`);
  }

  console.info('Maintenance complete.');
}

runMaintenance()
  .then(() => closePool())
  .then(() => process.exit(0))
  .catch((err) => { console.error('Maintenance failed:', err); process.exit(1); });
