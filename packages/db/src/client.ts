import { Pool, type PoolClient } from 'pg';
import { getConfig } from '@pulseway/config';
import pino from 'pino';

const dbLogger = pino({
  level    : 'warn',
  base     : { service: 'db-pool' },
  timestamp: pino.stdTimeFunctions.isoTime,
});

let pool: Pool | null = null;

/**
 * Returns the singleton pg connection pool.
 *
 * Connection routing:
 * - Direct to Postgres in development / when PGBOUNCER=false
 * - Via PgBouncer in production — set DATABASE_URL to the PgBouncer address
 *   and PGBOUNCER=true to disable prepared statements (incompatible with
 *   PgBouncer transaction mode).
 *
 * Never call this before loadConfig() has resolved.
 */
export function getPool(): Pool {
  if (pool) return pool;

  const config      = getConfig();
  const isPgBouncer = config.PGBOUNCER; // boolean, already transformed by Zod

  pool = new Pool({
    connectionString       : config.DATABASE_URL,
    max                    : config.DB_POOL_MAX,
    idleTimeoutMillis      : 30_000,
    connectionTimeoutMillis: 10_000,
    statement_timeout      : 30_000,
    // query_timeout only adds value with PgBouncer where statement_timeout
    // may not propagate reliably across multiplexed connections
    ...(isPgBouncer ? { query_timeout: 30_000 } : {}),
  });

  pool.on('error', (err, _client) => {
    dbLogger.error({ err }, '[pg pool] Unexpected client error — client ejected');
  });

  pool.on('connect', (client: PoolClient) => {
    if (isPgBouncer) {
      // force_generic_plan prevents prepared statement caching which is incompatible
      // with PgBouncer transaction mode (connections are not session-stable)
      client.query('SET plan_cache_mode = force_generic_plan').catch((err) =>
        dbLogger.warn({ err }, 'Failed to set plan_cache_mode — PgBouncer compatibility may be degraded'),
      );
    }
  });

  pool.on('acquire', (_client: PoolClient) => {
    // Connection acquired from pool — useful for debugging pool exhaustion
    dbLogger.trace('Pool connection acquired');
  });

  dbLogger.info(
    {
      max        : config.DB_POOL_MAX,
      pgbouncer  : isPgBouncer,
      environment: config.NODE_ENV,
    },
    'pg pool initialised',
  );

  return pool;
}

export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
    dbLogger.info('pg pool closed');
  }
}

/**
 * Health check — returns true if the pool can execute a simple query.
 * Used by /health/ready.
 */
export async function checkPoolHealth(): Promise<boolean> {
  try {
    const result = await getPool().query<{ ok: number }>('SELECT 1 AS ok');
    return result.rows[0]?.ok === 1;
  } catch (err) {
    dbLogger.error({ err }, 'Pool health check failed');
    return false;
  }
}
