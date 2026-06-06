import { Pool } from 'pg';
import { getConfig } from '@pulseway/config';

let pool: Pool | null = null;

/**
 * Returns the singleton pg Pool.
 *
 * For production: point DATABASE_URL at PgBouncer (transaction mode) rather than
 * directly at Postgres. PgBouncer multiplexes connections from all service instances
 * into a smaller pool against Postgres, preventing max_connections exhaustion.
 *
 * PgBouncer transaction mode disallows prepared statements — pg's built-in
 * statement preparation is disabled below via statement_timeout and the
 * PG_DISABLE_PREPARED flag (set automatically when PGBOUNCER=true).
 */
export function getPool(): Pool {
  if (!pool) {
    const config = getConfig();
    const isPgBouncer = process.env['PGBOUNCER'] === 'true';

    pool = new Pool({
      connectionString: config.DATABASE_URL,
      max             : config.DB_POOL_MAX,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
      // Disable prepared statements when routing through PgBouncer transaction mode
      // Statement caching is incompatible with connection multiplexing
      statement_timeout: 30_000,
      ...(isPgBouncer ? { query_timeout: 30_000 } : {}),
    });

    pool.on('error', (err) => {
      console.error('[pg pool] Unexpected client error:', err);
    });

    pool.on('connect', (client) => {
      if (isPgBouncer) {
        // Disable prepared statements at session level for PgBouncer compatibility
        client.query('SET plan_cache_mode = force_generic_plan').catch(() => null);
      }
    });
  }
  return pool;
}

export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}
