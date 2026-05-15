import { describe, it, expect } from 'vitest';

const API_URL = process.env['SMOKE_API_URL'] ?? 'http://localhost:4000';

describe('Smoke Tests', () => {
  it('API health check returns ok', async () => {
    const res = await fetch(`${API_URL}/health`);
    expect(res.status).toBe(200);
    const body = await res.json() as { status: string };
    expect(body.status).toBe('ok');
  });

  it('auth endpoint reachable', async () => {
    const res = await fetch(`${API_URL}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'nonexistent@example.com', password: 'wrong' }),
    });
    // Should be 401 (service is up), not 5xx
    expect(res.status).toBe(401);
  });

  it('public status page returns 404 for unknown slug', async () => {
    const res = await fetch(`${API_URL}/api/status/nonexistent-workspace-slug-xyz`);
    expect(res.status).toBe(404);
  });
});
