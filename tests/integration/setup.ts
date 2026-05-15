import { Pool } from 'pg';
import Redis from 'ioredis';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

export const TEST_DB_URL    = 'postgresql://pulseway:pulseway@localhost:5433/pulseway_test';
export const TEST_REDIS_URL = 'redis://localhost:6380';

let pool: Pool | null = null;
let redis: Redis | null = null;

export async function getTestPool(): Promise<Pool> {
  if (!pool) {
    pool = new Pool({ connectionString: TEST_DB_URL });
    await pool.query('SELECT 1');
  }
  return pool;
}

export async function getTestRedis(): Promise<Redis> {
  if (!redis) {
    redis = new Redis(TEST_REDIS_URL, { lazyConnect: false, maxRetriesPerRequest: 3 });
    await redis.ping();
  }
  return redis;
}

export async function runMigrations(): Promise<void> {
  const pool = await getTestPool();
  const migrationsDir = join(process.cwd(), 'packages/db/src/migrations');
  const files = (await readdir(migrationsDir))
    .filter((f) => f.endsWith('.sql'))
    .sort();

  for (const file of files) {
    const sql = await readFile(join(migrationsDir, file), 'utf-8');
    await pool.query(sql);
  }
}

export async function truncateTables(): Promise<void> {
  const pool = await getTestPool();
  await pool.query(`
    TRUNCATE TABLE
      check_results, incident_timeline, incidents,
      alert_logs, notification_channels, stripe_events,
      monitors, workspace_members, workspaces,
      email_verification_tokens, refresh_tokens, users
    RESTART IDENTITY CASCADE
  `);
}

export async function teardown(): Promise<void> {
  await pool?.end();
  await redis?.quit();
  pool  = null;
  redis = null;
}
