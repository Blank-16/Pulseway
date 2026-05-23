import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { loadConfig } from '@pulseway/config';
import { getPool, closePool } from '@pulseway/db';
import { createApp } from '../../packages/api/src/app.js';
import type { Express } from 'express';
import request from 'supertest';

let app: Express;
let accessToken: string;
let workspaceId: string;
let monitorId  : string;
let incidentId : string;

beforeAll(async () => {
  await loadConfig();
  const instance = await createApp();
  app = instance.express;

  const pool = getPool();
  await pool.query('TRUNCATE users, workspaces, workspace_members, refresh_tokens, monitors, incidents CASCADE');

  const reg = await request(app).post('/api/auth/register').send({
    name: 'Incident Test', email: 'incidents@example.com', password: 'password123',
  });
  accessToken = reg.body.data.accessToken;

  const { rows: [ws] } = await pool.query<{ id: string }>(
    `SELECT w.id FROM workspaces w JOIN workspace_members wm ON wm.workspace_id = w.id
     JOIN users u ON u.id = wm.user_id WHERE u.email = 'incidents@example.com'`,
  );
  workspaceId = ws!.id;

  const monRes = await request(app)
    .post(`/api/monitors/workspace/${workspaceId}`)
    .set('Authorization', `Bearer ${accessToken}`)
    .send({ name: 'Test', url: 'https://example.com', httpMethod: 'GET', requestHeaders: {}, expectedStatusCode: 200, checkIntervalSeconds: 60, regionCodes: ['us-east-1'] });
  monitorId = monRes.body.data.id;

  // Inject a test incident directly
  const { rows: [inc] } = await pool.query<{ id: string }>(
    `INSERT INTO incidents (monitor_id) VALUES ($1) RETURNING id`, [monitorId],
  );
  incidentId = inc!.id;
});

afterAll(async () => { await closePool(); });

describe('Incidents', () => {
  it('lists incidents in workspace', async () => {
    const res = await request(app)
      .get(`/api/incidents/workspace/${workspaceId}`)
      .set('Authorization', `Bearer ${accessToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].id).toBe(incidentId);
  });

  it('gets incident detail with timeline', async () => {
    const res = await request(app)
      .get(`/api/incidents/${incidentId}/workspace/${workspaceId}`)
      .set('Authorization', `Bearer ${accessToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe(incidentId);
    expect(res.body.data.timeline).toBeDefined();
  });

  it('returns 404 for wrong workspace', async () => {
    const res = await request(app)
      .get(`/api/incidents/${incidentId}/workspace/00000000-0000-0000-0000-000000000000`)
      .set('Authorization', `Bearer ${accessToken}`);
    expect(res.status).toBe(404);
  });

  it('acknowledges an incident', async () => {
    const res = await request(app)
      .post(`/api/incidents/${incidentId}/workspace/${workspaceId}/acknowledge`)
      .set('Authorization', `Bearer ${accessToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('acknowledged');
  });

  it('adds a note to an incident', async () => {
    const res = await request(app)
      .post(`/api/incidents/${incidentId}/workspace/${workspaceId}/notes`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ note: 'Investigating the issue' });
    expect(res.status).toBe(201);
    expect(res.body.data.message).toBe('Investigating the issue');
  });

  it('resolves an incident', async () => {
    const res = await request(app)
      .post(`/api/incidents/${incidentId}/workspace/${workspaceId}/resolve`)
      .set('Authorization', `Bearer ${accessToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('resolved');
  });

  it('cursor pagination returns non-overlapping pages', async () => {
    const pool = getPool();
    // Insert 5 more incidents
    for (let i = 0; i < 5; i++) {
      await pool.query('INSERT INTO incidents (monitor_id) VALUES ($1)', [monitorId]);
    }

    const p1 = await request(app)
      .get(`/api/incidents/workspace/${workspaceId}?pageSize=3`)
      .set('Authorization', `Bearer ${accessToken}`);
    expect(p1.body.data).toHaveLength(3);
    expect(p1.body.nextCursor).toBeTruthy();

    const p2 = await request(app)
      .get(`/api/incidents/workspace/${workspaceId}?pageSize=3&cursor=${p1.body.nextCursor}`)
      .set('Authorization', `Bearer ${accessToken}`);
    expect(p2.body.data.length).toBeGreaterThan(0);

    const ids1 = new Set(p1.body.data.map((i: { id: string }) => i.id));
    for (const item of p2.body.data) {
      expect(ids1.has(item.id)).toBe(false);
    }
  });
});
