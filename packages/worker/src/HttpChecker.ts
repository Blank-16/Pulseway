import https from 'node:https';
import http from 'node:http';
import dns from 'node:dns/promises';
import net from 'node:net';
import type { MonitorStatus } from '@pulseway/types';

export interface CheckResult {
  status: MonitorStatus;
  statusCode: number | null;
  responseTimeMs: number;
  errorMessage: string | null;
}

interface CheckRequest {
  url: string;
  httpMethod: string;
  requestHeaders: Record<string, string>;
  expectedStatusCode: number;
}

const TIMEOUT_MS = 10_000;
const MAX_REDIRECTS = 3;

// Blocked headers — user input must not override these
const BLOCKED_HEADERS = new Set([
  'host', 'transfer-encoding', 'content-length', 'connection',
  'keep-alive', 'proxy-authenticate', 'proxy-authorization', 'te',
  'trailers', 'upgrade',
]);

// RFC 1918 + loopback + link-local + metadata service ranges
const BLOCKED_CIDRS: Array<{ base: number; mask: number }> = [
  { base: ip('127.0.0.0'),   mask: 0xff000000 },   // 127.0.0.0/8
  { base: ip('10.0.0.0'),    mask: 0xff000000 },   // 10.0.0.0/8
  { base: ip('172.16.0.0'),  mask: 0xfff00000 },   // 172.16.0.0/12
  { base: ip('192.168.0.0'), mask: 0xffff0000 },   // 192.168.0.0/16
  { base: ip('169.254.0.0'), mask: 0xffff0000 },   // 169.254.0.0/16 (link-local / EC2 metadata)
  { base: ip('0.0.0.0'),     mask: 0xff000000 },   // 0.0.0.0/8
  { base: ip('100.64.0.0'),  mask: 0xffc00000 },   // 100.64.0.0/10 (carrier-grade NAT)
];

function ip(s: string): number {
  return s.split('.').reduce((acc, o) => (acc << 8) | parseInt(o, 10), 0) >>> 0;
}

function isPrivateIp(address: string): boolean {
  if (net.isIPv6(address)) return address === '::1' || address.startsWith('fc') || address.startsWith('fd');
  if (!net.isIPv4(address)) return false;
  const n = ip(address) >>> 0;
  return BLOCKED_CIDRS.some(({ base, mask }) => (n & mask) === base);
}

async function assertSafeHost(hostname: string): Promise<void> {
  // Reject bare IPs that are private without DNS lookup
  if (net.isIP(hostname)) {
    if (isPrivateIp(hostname)) throw new Error(`SSRF: private IP address blocked: ${hostname}`);
    return;
  }
  // Resolve and check all returned addresses
  let addresses: string[];
  try {
    const v4 = await dns.resolve4(hostname).catch(() => [] as string[]);
    const v6 = await dns.resolve6(hostname).catch(() => [] as string[]);
    addresses = [...v4, ...v6];
  } catch {
    throw new Error(`DNS resolution failed for ${hostname}`);
  }
  if (addresses.length === 0) throw new Error(`DNS resolution failed for ${hostname}`);
  for (const addr of addresses) {
    if (isPrivateIp(addr)) throw new Error(`SSRF: ${hostname} resolves to private IP ${addr}`);
  }
}

function sanitizeHeaders(headers: Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(headers).filter(([k]) => !BLOCKED_HEADERS.has(k.toLowerCase())),
  );
}

const httpsAgent = new https.Agent({ keepAlive: true, maxSockets: 256, maxFreeSockets: 64, timeout: TIMEOUT_MS });
const httpAgent  = new http.Agent ({ keepAlive: true, maxSockets: 256, maxFreeSockets: 64, timeout: TIMEOUT_MS });

function makeRequest(
  url: string,
  method: string,
  headers: Record<string, string>,
  redirectsLeft: number,
): Promise<{ statusCode: number }> {
  return new Promise((resolve, reject) => {
    const parsed    = new URL(url);
    const isHttps   = parsed.protocol === 'https:';
    const transport = isHttps ? https : http;
    const agent     = isHttps ? httpsAgent : httpAgent;

    const options: https.RequestOptions = {
      hostname : parsed.hostname,
      port     : parsed.port || undefined,
      path     : parsed.pathname + parsed.search,
      method,
      agent,
      headers  : { 'User-Agent': 'Pulseway-Monitor/1.0', ...sanitizeHeaders(headers) },
      timeout  : TIMEOUT_MS,
    };

    const req = transport.request(options, (res) => {
      res.resume();
      const statusCode = res.statusCode ?? 0;
      const location   = res.headers['location'];

      if (statusCode >= 301 && statusCode <= 308 && location && redirectsLeft > 0) {
        const nextUrl = location.startsWith('http') ? location : `${parsed.origin}${location}`;
        // Validate redirect target is also safe
        const nextHostname = new URL(nextUrl).hostname;
        assertSafeHost(nextHostname)
          .then(() => makeRequest(nextUrl, method, headers, redirectsLeft - 1))
          .then(resolve, reject);
        return;
      }

      resolve({ statusCode });
    });

    req.on('timeout', () => { req.destroy(); reject(new Error(`Timed out after ${TIMEOUT_MS}ms`)); });
    req.on('error', reject);
    req.end();
  });
}

export class HttpChecker {
  async check(params: CheckRequest): Promise<CheckResult> {
    const startTime = Date.now();
    try {
      const parsed = new URL(params.url);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        throw new Error(`Unsupported protocol: ${parsed.protocol}`);
      }
      await assertSafeHost(parsed.hostname);

      const { statusCode } = await makeRequest(params.url, params.httpMethod, params.requestHeaders, MAX_REDIRECTS);
      const responseTimeMs = Date.now() - startTime;
      const status: MonitorStatus = statusCode === params.expectedStatusCode ? 'up' : 'degraded';
      return { status, statusCode, responseTimeMs, errorMessage: null };
    } catch (err) {
      return {
        status        : 'down',
        statusCode    : null,
        responseTimeMs: Date.now() - startTime,
        errorMessage  : err instanceof Error ? err.message : 'Unknown error',
      };
    }
  }
}
