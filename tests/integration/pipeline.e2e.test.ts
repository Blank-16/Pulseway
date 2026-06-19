/**
 * End-to-end pipeline test.
 *
 * Tests the full flow:
 *   register → verify email → create monitor → simulate check results →
 *   incident opens → SSE event delivered → incident acknowledged → incident resolved
 *
 * Requires: Docker Compose services running (Postgres + Redis)
 *   docker compose -f tests/integration/docker-compose.test.yml up -d
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import EventSource from 'eventsource';
import { loadConfig } from '@pulseway/config';
import { getPool, closePool } from '@pulseway/db';
import { createApp } from '../../packages/api/src/app.js';

// Stub out email sending — we don't want real SES/ACS calls in tests
vi.mock('@pulseway/config', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@pulseway/config')>();
  return {
    ...actual,
    sendEmail: vi.fn().mockResolvedValue(undefined),
  };
});

let app          : Express;
let accessToken  : string;
let workspaceId  : string;
let monitorId    : string;
let incidentId   : string;
let serverUrl    : string;
let httpServer   : ReturnType<Express['listen']>;

beforeAll(async () => {
  await loadConfig();
  const instance = await createApp();
  app = instance.express;

  // Start a real HTTP server so EventSource can connect
  httpServer = app.listen(0);
  const address = httpServer.address() as { port: number };
  serverUrl = `http://localhost:${address.port}`;

  const pool = getPool();
  await pool.query(`
    TRUNCATE users, workspaces, workspace_members, refresh_tokens,
             monitors, incidents, check_results, incident_timeline,
             email_verification_tokens CASCADE
  `);
});

afterAll(async () => {
  httpServer?.close();
  await closePool();
});

describe('Full pipeline', () => {
  it('registers a new user', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ name: 'Pipeline Test', email: 'pipeline@example.com', password: 'password123' });

    expect(res.status).toBe(201);
    expect(res.body.data.accessToken).toBeTruthy();
    accessToken = res.body.data.accessToken;
    workspaceId = res.body.data.workspace.id;
  });

  it('marks email as verified (simulates token redemption)', async () => {
    const pool = getPool();
    await pool.query(
      'UPDATE users SET email_verified = true WHERE email = $1',
      ['pipeline@example.com'],
    );
    // Login to get a fresh token post-verification
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'pipeline@example.com', password: 'password123' });
    expect(res.status).toBe(200);
    accessToken = res.body.data.accessToken;
  });

  it('creates a monitor', async () => {
    const res = await request(app)
      .post(`/api/monitors/workspace/${workspaceId}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        name               : 'Pipeline Monitor',
        url                : 'https://example.com',
        httpMethod         : 'GET',
        requestHeaders     : {},
        expectedStatusCode : 200,
        checkIntervalSeconds: 60,
        regionCodes        : ['us-east-1'],
      });

    expect(res.status).toBe(201);
    expect(res.body.data.id).toBeTruthy();
    monitorId = res.body.data.id;
  });

  it('SSE connection returns a snapshot event on connect', async () => {
    const snapshot = await new Promise<Record<string, unknown>>((resolve, reject) => {
      const es = new EventSource(
        `${serverUrl}/api/events/workspace/${workspaceId}`,
        { headers: { Authorization: `Bearer ${accessToken}` } },
      );
      const timer = setTimeout(() => { es.close(); reject(new Error('Snapshot timeout')); }, 5_000);
      es.addEventListener('snapshot', (e: MessageEvent) => {
        clearTimeout(timer);
        es.close();
        resolve(JSON.parse(e.data as string) as Record<string, unknown>);
      });
      es.onerror = () => { clearTimeout(timer); es.close(); reject(new Error('SSE error')); };
    });

    expect(snapshot).toHaveProperty('monitors');
    expect(Array.isArray((snapshot as { monitors: unknown[] }).monitors)).toBe(true);
  });

  it('opening 3 failing check results opens an incident via IncidentEvaluator', async () => {
    const pool = getPool();

    // Insert 3 consecutive failing check results
    for (let i = 0; i < 3; i++) {
      await pool.query(
        `INSERT INTO check_results (monitor_id, status, status_code, response_time_ms, region, checked_at)
         VALUES ($1, 'down', 503, 1000, 'us-east-1', NOW() - ($2 || ' seconds')::INTERVAL)`,
        [monitorId, (2 - i) * 60],
      );
    }

    // Simulate what IncidentEvaluator would do (it runs in the worker process)
    // We call it directly here to test the full DB path
    const { IncidentEvaluator } = await import('../../packages/worker/src/IncidentEvaluator.js');
    const Redis = (await import('ioredis')).default;
    const redis = new Redis(process.env['REDIS_URL'] ?? 'redis://localhost:6380');
    const evaluator = new IncidentEvaluator(redis, redis);

    // Simulate 3 consecutive 'down' evaluations
    for (let i = 0; i < 3; i++) {
      await evaluator.evaluate(monitorId, workspaceId, 'down');
    }

    await redis.quit();

    // Verify incident was created
    const { rows } = await pool.query<{ id: string; status: string }>(
      `SELECT id, status FROM incidents WHERE monitor_id = $1 AND status != 'resolved' LIMIT 1`,
      [monitorId],
    );
    expect(rows.length).toBe(1);
    expect(rows[0]!.status).toBe('open');
    incidentId = rows[0]!.id;
  });

  it('SSE delivers incident:opened event after incident is created', async () => {
    expect(incidentId).toBeTruthy();

    const event = await new Promise<Record<string, unknown>>((resolve, reject) => {
      const es = new EventSource(
        `${serverUrl}/api/events/workspace/${workspaceId}`,
        { headers: { Authorization: `Bearer ${accessToken}` } },
      );
      const timer = setTimeout(() => { es.close(); reject(new Error('incident:opened event timeout')); }, 5_000);

      es.addEventListener('message', (e: MessageEvent) => {
        const data = JSON.parse(e.data as string) as { type: string };
        if (data.type === 'incident:opened') {
          clearTimeout(timer);
          es.close();
          resolve(data as Record<string, unknown>);
        }
      });

      // Trigger a publish to Redis (simulates worker publishing after evaluation)
      import('@pulseway/db').then(({ getPool }) => {
        const pool = getPool();
        pool.query(
          `NOTIFY "check-events", '{"type":"incident:opened","workspaceId":"${workspaceId}","data":{"incidentId":"${incidentId}","monitorId":"${monitorId}"}}'`,
        );
      });

      es.onerror = () => { clearTimeout(timer); es.close(); reject(new Error('SSE error')); };
    });

    expect(event['type']).toBe('incident:opened');
  });

  it('acknowledges the incident via API', async () => {
    const res = await request(app)
      .post(`/api/incidents/${incidentId}/workspace/${workspaceId}/acknowledge`)
      .set('Authorization', `Bearer ${accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('acknowledged');
  });

  it('adds a timeline note', async () => {
    const res = await request(app)
      .post(`/api/incidents/${incidentId}/workspace/${workspaceId}/notes`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ note: 'Investigating — looks like a CDN issue' });

    expect(res.status).toBe(201);
    expect(res.body.data.message).toBe('Investigating — looks like a CDN issue');
  });

  it('resolves the incident via API', async () => {
    const res = await request(app)
      .post(`/api/incidents/${incidentId}/workspace/${workspaceId}/resolve`)
      .set('Authorization', `Bearer ${accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('resolved');
  });

  it('resolved incident appears in the list with status=resolved', async () => {
    const res = await request(app)
      .get(`/api/incidents/workspace/${workspaceId}`)
      .set('Authorization', `Bearer ${accessToken}`);

    expect(res.status).toBe(200);
    const resolved = res.body.data.find((i: { id: string; status: string }) => i.id === incidentId);
    expect(resolved).toBeTruthy();
    expect(resolved.status).toBe('resolved');
  });

  it('IDOR: cannot access incident from another workspace', async () => {
    const res = await request(app)
      .get(`/api/incidents/${incidentId}/workspace/00000000-0000-0000-0000-000000000000`)
      .set('Authorization', `Bearer ${accessToken}`);

    expect(res.status).toBe(404);
  });

  it('cursor pagination returns non-overlapping pages', async () => {
    // Insert more incidents
    const pool = getPool();
    for (let i = 0; i < 5; i++) {
      await pool.query(
        `INSERT INTO incidents (monitor_id, status) VALUES ($1, 'resolved')`,
        [monitorId],
      );
    }

    const p1 = await request(app)
      .get(`/api/incidents/workspace/${workspaceId}?pageSize=3`)
      .set('Authorization', `Bearer ${accessToken}`);

    expect(p1.status).toBe(200);
    expect(p1.body.data.length).toBe(3);
    expect(p1.body.nextCursor).toBeTruthy();

    const p2 = await request(app)
      .get(`/api/incidents/workspace/${workspaceId}?pageSize=3&cursor=${p1.body.nextCursor}`)
      .set('Authorization', `Bearer ${accessToken}`);

    expect(p2.status).toBe(200);
    const ids1 = new Set(p1.body.data.map((i: { id: string }) => i.id));
    for (const item of p2.body.data) {
      expect(ids1.has(item.id)).toBe(false);
    }
  });
});
