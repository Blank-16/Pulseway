/**
 * Integration test — requires Docker Compose services to be running:
 *   docker compose -f tests/integration/docker-compose.test.yml up -d
 *
 * Run with: vitest run --project integration
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { getTestPool, runMigrations, truncateTables, teardown } from './setup.js';
import { IncidentRepository } from '../../packages/db/src/repositories/IncidentRepository.js';

// Override DB client to use test pool
vi.mock('../../packages/db/src/client.js', async () => {
  const { getTestPool } = await import('./setup.js');
  return { getPool: getTestPool };
});

import { vi } from 'vitest';

describe('IncidentRepository (integration)', () => {
  const repo = new IncidentRepository();
  let workspaceId: string;
  let monitorId  : string;

  beforeAll(async () => {
    await runMigrations();
    const pool = await getTestPool();
    const { rows: [ws] } = await pool.query<{ id: string }>(
      `INSERT INTO workspaces (name, slug) VALUES ('Test', 'test-${Date.now()}') RETURNING id`,
    );
    workspaceId = ws!.id;
    const { rows: [mon] } = await pool.query<{ id: string }>(
      `INSERT INTO monitors (workspace_id, name, url, http_method, expected_status_code, check_interval_seconds, region_codes)
       VALUES ($1, 'Test Monitor', 'https://example.com', 'GET', 200, 60, ARRAY['us-east-1']) RETURNING id`,
      [workspaceId],
    );
    monitorId = mon!.id;
  });

  beforeEach(() => truncateTables());
  afterAll(() => teardown());

  it('inserts and returns a new incident', async () => {
    const incident = await repo.insert(monitorId);
    expect(incident.monitorId).toBe(monitorId);
    expect(incident.status).toBe('open');
    expect(incident.startedAt).toBeTruthy();
  });

  it('deduplicates concurrent inserts via advisory lock', async () => {
    const [a, b] = await Promise.all([repo.insert(monitorId), repo.insert(monitorId)]);
    expect(a.id).toBe(b.id);

    const pool = await getTestPool();
    const { rows } = await pool.query<{ count: string }>(
      `SELECT COUNT(*) AS count FROM incidents WHERE monitor_id = $1`,
      [monitorId],
    );
    expect(rows[0]!.count).toBe('1');
  });

  it('resolves incident and sets resolved_at', async () => {
    const incident = await repo.insert(monitorId);
    const resolved = await repo.resolve(incident.id);
    expect(resolved!.status).toBe('resolved');
    expect(resolved!.resolvedAt).toBeTruthy();
    expect(resolved!.durationSeconds).toBeGreaterThanOrEqual(0);
  });

  it('keyset pagination returns correct pages', async () => {
    const pool = await getTestPool();
    // Insert 5 incidents with different started_at
    for (let i = 0; i < 5; i++) {
      await pool.query(
        `INSERT INTO incidents (monitor_id, started_at) VALUES ($1, NOW() - INTERVAL '${i} minutes')`,
        [monitorId],
      );
    }

    const page1 = await repo.findByWorkspace(workspaceId, 3);
    expect(page1.incidents).toHaveLength(3);
    expect(page1.nextCursor).toBeTruthy();

    const page2 = await repo.findByWorkspace(workspaceId, 3, page1.nextCursor!);
    expect(page2.incidents).toHaveLength(2);
    expect(page2.nextCursor).toBeNull();

    // No overlap between pages
    const ids1 = new Set(page1.incidents.map((i) => i.id));
    const ids2 = new Set(page2.incidents.map((i) => i.id));
    expect([...ids1].filter((id) => ids2.has(id))).toHaveLength(0);
  });

  it('findByIdAndWorkspace returns null for wrong workspace', async () => {
    const incident = await repo.insert(monitorId);
    const result   = await repo.findByIdAndWorkspace(incident.id, 'wrong-workspace-id');
    expect(result).toBeNull();
  });
});
