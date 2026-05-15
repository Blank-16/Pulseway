import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { loadConfig } from '@pulseway/config';
import { getPool, closePool } from '@pulseway/db';
import { createApp } from '../../packages/api/src/app.js';
import type { Express } from 'express';
import request from 'supertest';

let app: Express;

beforeAll(async () => {
  await loadConfig();
  const instance = await createApp();
  app = instance.express;
  await getPool().query('TRUNCATE users, workspaces, workspace_members, refresh_tokens CASCADE');
});

afterAll(async () => {
  await closePool();
});

describe('Auth', () => {
  const creds = { name: 'Test User', email: 'test@example.com', password: 'password123' };
  let accessToken: string;

  it('registers a new user', async () => {
    const res = await request(app).post('/api/auth/register').send(creds);
    expect(res.status).toBe(201);
    expect(res.body.data.accessToken).toBeTruthy();
    expect(res.body.data.user.email).toBe(creds.email);
    expect(res.headers['set-cookie']).toBeDefined();
  });

  it('rejects duplicate registration', async () => {
    const res = await request(app).post('/api/auth/register').send(creds);
    expect(res.status).toBe(409);
  });

  it('logs in with valid credentials', async () => {
    const res = await request(app).post('/api/auth/login').send({
      email: creds.email,
      password: creds.password,
    });
    expect(res.status).toBe(200);
    expect(res.body.data.accessToken).toBeTruthy();
    accessToken = res.body.data.accessToken;
  });

  it('rejects login with wrong password', async () => {
    const res = await request(app).post('/api/auth/login').send({
      email: creds.email,
      password: 'wrong',
    });
    expect(res.status).toBe(401);
  });

  it('rejects protected routes without token', async () => {
    const res = await request(app).get('/api/monitors/workspace/does-not-exist');
    expect(res.status).toBe(401);
  });

  it('refreshes access token via cookie', async () => {
    const loginRes = await request(app).post('/api/auth/login').send({
      email: creds.email,
      password: creds.password,
    });
    const cookie = loginRes.headers['set-cookie'] as string[];

    const res = await request(app)
      .post('/api/auth/refresh')
      .set('Cookie', cookie);

    expect(res.status).toBe(200);
    expect(res.body.data.accessToken).toBeTruthy();
  });

  it('logouts successfully', async () => {
    const loginRes = await request(app).post('/api/auth/login').send({
      email: creds.email,
      password: creds.password,
    });
    const cookie = loginRes.headers['set-cookie'] as string[];

    const logoutRes = await request(app)
      .post('/api/auth/logout')
      .set('Cookie', cookie);
    expect(logoutRes.status).toBe(200);

    // Refresh should now fail
    const refreshRes = await request(app)
      .post('/api/auth/refresh')
      .set('Cookie', cookie);
    expect(refreshRes.status).toBe(401);
  });
});
