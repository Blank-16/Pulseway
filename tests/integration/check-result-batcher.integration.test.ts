/**
 * Integration test — requires Docker Compose services to be running.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { getTestPool, runMigrations, truncateTables, teardown } from './setup.js';

vi.mock('../../packages/db/src/client.js', async () => {
  const { getTestPool } = await import('./setup.js');
  return { getPool: getTestPool };
});

import { CheckResultBatcher } from '../../packages/db/src/repositories/CheckResultBatcher.js';

describe('CheckResultBatcher (integration)', () => {
  let workspaceId: string;
  let monitorId  : string;

  beforeAll(async () => {
    await runMigrations();
    const pool = await getTestPool();
    const { rows: [ws] } = await pool.query<{ id: string }>(
      `INSERT INTO workspaces (name, slug) VALUES ('Batcher Test', 'batcher-${Date.now()}') RETURNING id`,
    );
    workspaceId = ws!.id;
    const { rows: [mon] } = await pool.query<{ id: string }>(
      `INSERT INTO monitors (workspace_id, name, url, http_method, expected_status_code, check_interval_seconds, region_codes)
       VALUES ($1, 'Batcher Monitor', 'https://example.com', 'GET', 200, 60, ARRAY['us-east-1']) RETURNING id`,
      [workspaceId],
    );
    monitorId = mon!.id;
  });

  beforeEach(() => truncateTables());
  afterAll(() => teardown());

  it('inserts multiple rows in one batch and resolves all promises', async () => {
    const batcher = new CheckResultBatcher();
    const N = 15;
    await Promise.all([
      ...Array.from({ length: N }, () =>
        batcher.enqueue({
          monitorId, status: 'up', statusCode: 200,
          responseTimeMs: 42, errorMessage: null, region: 'us-east-1',
        }),
      ),
      batcher.drain(),
    ]);

    const pool = await getTestPool();
    const { rows } = await pool.query<{ count: string }>(
      'SELECT COUNT(*) AS count FROM check_results WHERE monitor_id = $1',
      [monitorId],
    );
    expect(parseInt(rows[0]!.count, 10)).toBe(N);
  });

  it('drain() waits for all in-flight rows before returning', async () => {
    const batcher = new CheckResultBatcher();
    const promises = Array.from({ length: 5 }, (_, i) =>
      batcher.enqueue({
        monitorId, status: i % 2 === 0 ? 'up' : 'down', statusCode: 200,
        responseTimeMs: i * 10, errorMessage: null, region: 'us-east-1',
      }),
    );

    await batcher.drain();
    // All promises should be settled after drain
    const results = await Promise.allSettled(promises);
    expect(results.every((r) => r.status === 'fulfilled')).toBe(true);
  });
});
