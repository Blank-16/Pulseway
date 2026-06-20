import { readdir, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import pino from 'pino';
import { getPool } from './client.js';
import { loadConfig } from '@pulseway/config';

const logger = pino({
  level    : 'info',
  base     : { service: 'migrate' },
  timestamp: pino.stdTimeFunctions.isoTime,
});

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), 'migrations');

function checksum(sql: string): string {
  return createHash('sha256').update(sql).digest('hex').slice(0, 16);
}

async function ensureMigrationsTable(): Promise<void> {
  await getPool().query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version    TEXT        PRIMARY KEY,
      checksum   TEXT,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

async function getApplied(): Promise<Map<string, string | null>> {
  const { rows } = await getPool().query<{ version: string; checksum: string | null }>(
    'SELECT version, checksum FROM schema_migrations ORDER BY version',
  );
  return new Map(rows.map((r) => [r.version, r.checksum]));
}

async function runMigrations(): Promise<void> {
  await loadConfig();
  await ensureMigrationsTable();

  const applied = await getApplied();
  const files   = (await readdir(MIGRATIONS_DIR))
    .filter((f) => f.endsWith('.sql'))
    .sort();

  // Verify checksums of previously-applied migrations — abort on tampering
  for (const file of files) {
    const recorded = applied.get(file);
    if (!recorded) continue;
    const sql      = await readFile(join(MIGRATIONS_DIR, file), 'utf-8');
    const computed = checksum(sql);
    if (recorded !== computed) {
      logger.fatal(
        { file, recorded, computed },
        'Checksum mismatch — migration file was modified after being applied. Aborting.',
      );
      process.exit(1);
    }
  }

  const pending = files.filter((f) => !applied.has(f));
  if (pending.length === 0) {
    logger.info('No pending migrations');
    return;
  }

  logger.info({ count: pending.length }, 'Running migrations');
  const pool = getPool();

  for (const file of pending) {
    const sql  = await readFile(join(MIGRATIONS_DIR, file), 'utf-8');
    const hash = checksum(sql);
    logger.info({ file, checksum: hash }, 'Applying migration');

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query(
        'INSERT INTO schema_migrations (version, checksum) VALUES ($1, $2)',
        [file, hash],
      );
      await client.query('COMMIT');
      logger.info({ file }, 'Migration applied');
    } catch (err) {
      await client.query('ROLLBACK');
      logger.error({ err, file }, 'Migration failed — rolled back');
      throw err;
    } finally {
      client.release();
    }
  }

  logger.info({ applied: pending.length }, 'All migrations complete');
}

runMigrations()
  .then(() => process.exit(0))
  .catch((err) => {
    logger.fatal({ err }, 'Migration runner failed');
    process.exit(1);
  });
