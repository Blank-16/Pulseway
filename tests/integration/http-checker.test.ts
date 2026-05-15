import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import { HttpChecker } from '../../packages/worker/src/HttpChecker.js';

let server: http.Server;
let port: number;

beforeAll(async () => {
  server = http.createServer((req, res) => {
    switch (req.url) {
      case '/ok':
        res.writeHead(200);
        res.end('ok');
        break;
      case '/not-found':
        res.writeHead(404);
        res.end('not found');
        break;
      case '/slow':
        setTimeout(() => { res.writeHead(200); res.end('slow'); }, 100);
        break;
      default:
        res.writeHead(500);
        res.end('error');
    }
  });

  await new Promise<void>((resolve) => server.listen(0, resolve));
  port = (server.address() as { port: number }).port;
});

afterAll(() => {
  server.close();
});

describe('HttpChecker', () => {
  const checker = new HttpChecker();

  it('returns up when status matches expected', async () => {
    const result = await checker.check({
      url: `http://localhost:${port}/ok`,
      httpMethod: 'GET',
      requestHeaders: {},
      expectedStatusCode: 200,
    });

    expect(result.status).toBe('up');
    expect(result.statusCode).toBe(200);
    expect(result.responseTimeMs).toBeGreaterThan(0);
    expect(result.errorMessage).toBeNull();
  });

  it('returns degraded when status does not match expected', async () => {
    const result = await checker.check({
      url: `http://localhost:${port}/not-found`,
      httpMethod: 'GET',
      requestHeaders: {},
      expectedStatusCode: 200,
    });

    expect(result.status).toBe('degraded');
    expect(result.statusCode).toBe(404);
  });

  it('returns down when connection is refused', async () => {
    const result = await checker.check({
      url: 'http://localhost:1',
      httpMethod: 'GET',
      requestHeaders: {},
      expectedStatusCode: 200,
    });

    expect(result.status).toBe('down');
    expect(result.statusCode).toBeNull();
    expect(result.errorMessage).toBeTruthy();
  });

  it('measures response time', async () => {
    const result = await checker.check({
      url: `http://localhost:${port}/slow`,
      httpMethod: 'GET',
      requestHeaders: {},
      expectedStatusCode: 200,
    });

    expect(result.responseTimeMs).toBeGreaterThanOrEqual(100);
  });

  it('passes custom headers', async () => {
    const result = await checker.check({
      url: `http://localhost:${port}/ok`,
      httpMethod: 'GET',
      requestHeaders: { 'X-Custom-Header': 'test' },
      expectedStatusCode: 200,
    });

    expect(result.status).toBe('up');
  });

  it('supports HEAD method', async () => {
    const result = await checker.check({
      url: `http://localhost:${port}/ok`,
      httpMethod: 'HEAD',
      requestHeaders: {},
      expectedStatusCode: 200,
    });

    expect(result.status).toBe('up');
  });
});
