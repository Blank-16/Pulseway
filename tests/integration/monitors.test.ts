import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { loadConfig } from '@pulseway/config';
import { getPool, closePool } from '@pulseway/db';
import { createApp } from '../../packages/api/src/app.js';
import type { Express } from 'express';
import request from 'supertest';

let app: Express;
let accessToken: string;
let workspaceId: string;
let monitorId: string;

beforeAll(async () => {
  await loadConfig();
  const instance = await createApp();
  app = instance.express;
  await getPool().query('TRUNCATE users, workspaces, workspace_members, refresh_tokens CASCADE');

  const regRes = await request(app).post('/api/auth/register').send({
    name: 'Monitor Test',
    email: 'monitor@example.com',
    password: 'password123',
  });
  accessToken = regRes.body.data.accessToken;

  const wsRes = await request(app)
    .get('/api/monitors/workspace/invalid')
    .set('Authorization', `Bearer ${accessToken}`);

  // Fetch workspaces list by finding it from member endpoint
  const poolRes = await getPool().query<{ id: string }>(
    `SELECT w.id FROM workspaces w
     JOIN workspace_members wm ON wm.workspace_id = w.id
     JOIN users u ON u.id = wm.user_id
     WHERE u.email = 'monitor@example.com'`,
  );
  workspaceId = poolRes.rows[0]!.id;
});

afterAll(async () => {
  await closePool();
});

describe('Monitors', () => {
  it('creates a monitor', async () => {
    const res = await request(app)
      .post(`/api/monitors/workspace/${workspaceId}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        name: 'Test API',
        url: 'https://example.com',
        httpMethod: 'GET',
        requestHeaders: {},
        expectedStatusCode: 200,
        checkIntervalSeconds: 60,
        regionCodes: ['us-east-1'],
      });

    expect(res.status).toBe(201);
    expect(res.body.data.id).toBeTruthy();
    expect(res.body.data.name).toBe('Test API');
    monitorId = res.body.data.id;
  });

  it('lists monitors in workspace', async () => {
    const res = await request(app)
      .get(`/api/monitors/workspace/${workspaceId}`)
      .set('Authorization', `Bearer ${accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
  });

  it('gets monitor detail', async () => {
    const res = await request(app)
      .get(`/api/monitors/${monitorId}/workspace/${workspaceId}`)
      .set('Authorization', `Bearer ${accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe(monitorId);
    expect(res.body.data.uptime30d).toBeDefined();
  });

  it('updates a monitor', async () => {
    const res = await request(app)
      .patch(`/api/monitors/${monitorId}/workspace/${workspaceId}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ name: 'Updated Name', checkIntervalSeconds: 300 });

    expect(res.status).toBe(200);
    expect(res.body.data.name).toBe('Updated Name');
    expect(res.body.data.checkIntervalSeconds).toBe(300);
  });

  it('rejects monitor creation beyond free plan limit', async () => {
    // Create 2 more to hit the 3-monitor free limit
    for (let i = 0; i < 2; i++) {
      await request(app)
        .post(`/api/monitors/workspace/${workspaceId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          name: `Monitor ${i + 2}`,
          url: `https://example${i}.com`,
          httpMethod: 'GET',
          requestHeaders: {},
          expectedStatusCode: 200,
          checkIntervalSeconds: 60,
          regionCodes: ['us-east-1'],
        });
    }

    const res = await request(app)
      .post(`/api/monitors/workspace/${workspaceId}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        name: 'Over limit',
        url: 'https://overlimit.com',
        httpMethod: 'GET',
        requestHeaders: {},
        expectedStatusCode: 200,
        checkIntervalSeconds: 60,
        regionCodes: ['us-east-1'],
      });

    expect(res.status).toBe(403);
  });

  it('deletes a monitor', async () => {
    const res = await request(app)
      .delete(`/api/monitors/${monitorId}/workspace/${workspaceId}`)
      .set('Authorization', `Bearer ${accessToken}`);

    expect(res.status).toBe(204);
  });

  it('returns 404 for deleted monitor', async () => {
    const res = await request(app)
      .get(`/api/monitors/${monitorId}/workspace/${workspaceId}`)
      .set('Authorization', `Bearer ${accessToken}`);

    expect(res.status).toBe(404);
  });
});
