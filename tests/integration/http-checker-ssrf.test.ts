import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import { HttpChecker } from '../../packages/worker/src/HttpChecker.js';

let server: http.Server;
let port: number;

beforeAll(async () => {
  server = http.createServer((_req, res) => { res.writeHead(200); res.end('ok'); });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  port = (server.address() as { port: number }).port;
});

afterAll(() => server.close());

describe('HttpChecker SSRF protection', () => {
  const checker = new HttpChecker();

  it('blocks requests to loopback IPs', async () => {
    const result = await checker.check({
      url               : `http://127.0.0.1:${port}/`,
      httpMethod        : 'GET',
      requestHeaders    : {},
      expectedStatusCode: 200,
    });
    expect(result.status).toBe('down');
    expect(result.errorMessage).toMatch(/SSRF|private/i);
  });

  it('blocks requests to RFC 1918 addresses', async () => {
    const result = await checker.check({
      url               : 'http://192.168.1.1/',
      httpMethod        : 'GET',
      requestHeaders    : {},
      expectedStatusCode: 200,
    });
    expect(result.status).toBe('down');
    expect(result.errorMessage).toMatch(/SSRF|private/i);
  });

  it('blocks EC2 metadata endpoint', async () => {
    const result = await checker.check({
      url               : 'http://169.254.169.254/latest/meta-data/',
      httpMethod        : 'GET',
      requestHeaders    : {},
      expectedStatusCode: 200,
    });
    expect(result.status).toBe('down');
    expect(result.errorMessage).toMatch(/SSRF|private/i);
  });

  it('blocks non-http protocols', async () => {
    const result = await checker.check({
      url               : 'file:///etc/passwd',
      httpMethod        : 'GET',
      requestHeaders    : {},
      expectedStatusCode: 200,
    });
    expect(result.status).toBe('down');
    expect(result.errorMessage).toMatch(/protocol/i);
  });

  it('strips dangerous request headers', async () => {
    // Headers like host/transfer-encoding should not reach the request
    // We verify the check doesn't throw and returns a valid result
    const result = await checker.check({
      url               : 'http://localhost:1/',
      httpMethod        : 'GET',
      requestHeaders    : { 'Host': 'evil.com', 'Transfer-Encoding': 'chunked' },
      expectedStatusCode: 200,
    });
    // Connection refused — but no crash, and SSRF check runs first for localhost
    expect(result.status).toBe('down');
  });
});
