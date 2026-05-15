import { Pool } from 'pg';
import { getConfig } from '@pulseway/config';
import pino from 'pino';

const logger = pino({ name: 'db-pool' });
let pool: Pool | null = null;

export function getPool(): Pool {
  if (!pool) {
    const config = getConfig();
    pool = new Pool({
      connectionString         : config.DATABASE_URL,
      max                      : 20,
      idleTimeoutMillis        : 30_000,
      connectionTimeoutMillis  : 5_000,
    });
    pool.on('error', (err) => logger.error({ err }, 'Unexpected pg pool error'));
  }
  return pool;
}

export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}
