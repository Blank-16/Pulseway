import { describe, it, expect } from 'vitest';

const API_URL = process.env['SMOKE_API_URL'] ?? 'http://localhost:4000';

describe('Smoke Tests', () => {
  it('/health/live returns 200 with status ok (process alive)', async () => {
    const res = await fetch(`${API_URL}/health/live`);
    expect(res.status).toBe(200);
    const body = await res.json() as { status: string; uptime: number };
    expect(body.status).toBe('ok');
    expect(typeof body.uptime).toBe('number');
  });

  it('/health/ready returns 200 with status ready (all deps reachable)', async () => {
    const res = await fetch(`${API_URL}/health/ready`);
    // In a smoke test context the deps should be up — fail loudly if not
    expect(res.status).toBe(200);
    const body = await res.json() as { status: string; checks: Record<string, string> };
    expect(body.status).toBe('ready');
    expect(body.checks['database']).toBe('ok');
    expect(body.checks['redis']).toBe('ok');
  });

  it('/health legacy alias resolves to readiness check', async () => {
    const res = await fetch(`${API_URL}/health`);
    // The legacy /health alias points to readinessHandler
    expect([200, 503]).toContain(res.status);
    const body = await res.json() as { status: string };
    expect(['ready', 'unavailable']).toContain(body.status);
  });

  it('auth endpoint reachable — 401 for bad credentials', async () => {
    const res = await fetch(`${API_URL}/api/auth/login`, {
      method : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body   : JSON.stringify({ email: 'nonexistent@example.com', password: 'wrong' }),
    });
    // 401 = service is up and handling auth correctly
    // 403 = email not verified (also acceptable — service is up)
    expect([401, 403]).toContain(res.status);
  });

  it('public status page returns 404 for unknown workspace slug', async () => {
    const res = await fetch(`${API_URL}/api/status/nonexistent-workspace-slug-xyz-smoke`);
    expect(res.status).toBe(404);
  });

  it('/api/docs returns HTML (OpenAPI UI reachable)', async () => {
    const res = await fetch(`${API_URL}/api/docs`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');
  });

  it('/api/openapi.json returns a valid OpenAPI document', async () => {
    const res = await fetch(`${API_URL}/api/openapi.json`);
    expect(res.status).toBe(200);
    const spec = await res.json() as { openapi: string; info: { title: string } };
    expect(spec.openapi).toMatch(/^3\./);
    expect(spec.info.title).toBeTruthy();
  });
});
