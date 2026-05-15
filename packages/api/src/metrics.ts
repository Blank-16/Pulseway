/**
 * Minimal Prometheus text-format metrics endpoint — no external dependency.
 * Counters and gauges are updated by the application in-process.
 * For multi-instance deployments, scrape all instances individually or use
 * a push-gateway; the endpoint itself is stateless per-process.
 */

interface Counter  { value: number; help: string; labels?: Record<string, string>; }
interface Gauge    { value: number; help: string; }
interface Histogram { buckets: Map<number, number>; sum: number; count: number; help: string; }

const counters   = new Map<string, Counter>();
const gauges     = new Map<string, Gauge>();
const histograms = new Map<string, Histogram>();

export function inc(name: string, help: string, amount = 1, labels?: Record<string, string>): void {
  const key = labels ? `${name}{${Object.entries(labels).map(([k, v]) => `${k}="${v}"`).join(',')}}` : name;
  const existing = counters.get(key);
  if (existing) {
    existing.value += amount;
  } else {
    counters.set(key, { value: amount, help, labels });
  }
}

export function setGauge(name: string, help: string, value: number): void {
  gauges.set(name, { value, help });
}

const RESPONSE_TIME_BUCKETS = [10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000];

export function observeResponseTime(name: string, help: string, ms: number): void {
  let h = histograms.get(name);
  if (!h) {
    h = { buckets: new Map(RESPONSE_TIME_BUCKETS.map((b) => [b, 0])), sum: 0, count: 0, help };
    histograms.set(name, h);
  }
  h.sum += ms;
  h.count++;
  for (const bound of RESPONSE_TIME_BUCKETS) {
    if (ms <= bound) h.buckets.set(bound, (h.buckets.get(bound) ?? 0) + 1);
  }
}

export function renderMetrics(): string {
  const lines: string[] = [];

  for (const [name, c] of counters) {
    const baseName = name.includes('{') ? name.split('{')[0]! : name;
    lines.push(`# HELP ${baseName} ${c.help}`);
    lines.push(`# TYPE ${baseName} counter`);
    lines.push(`${name} ${c.value}`);
  }

  for (const [name, g] of gauges) {
    lines.push(`# HELP ${name} ${g.help}`);
    lines.push(`# TYPE ${name} gauge`);
    lines.push(`${name} ${g.value}`);
  }

  for (const [name, h] of histograms) {
    lines.push(`# HELP ${name} ${h.help}`);
    lines.push(`# TYPE ${name} histogram`);
    let cumulative = 0;
    for (const [bound, count] of h.buckets) {
      cumulative += count;
      lines.push(`${name}_bucket{le="${bound}"} ${cumulative}`);
    }
    lines.push(`${name}_bucket{le="+Inf"} ${h.count}`);
    lines.push(`${name}_sum ${h.sum}`);
    lines.push(`${name}_count ${h.count}`);
  }

  return lines.join('\n') + '\n';
}

// Named metric constants used across the codebase
export const Metrics = {
  HTTP_REQUESTS_TOTAL     : 'http_requests_total',
  HTTP_RESPONSE_TIME_MS   : 'http_response_time_ms',
  CHECK_JOBS_PROCESSED    : 'check_jobs_processed_total',
  CHECK_JOBS_FAILED       : 'check_jobs_failed_total',
  INCIDENTS_OPENED        : 'incidents_opened_total',
  INCIDENTS_RESOLVED      : 'incidents_resolved_total',
  ALERT_SENT              : 'alerts_sent_total',
  ALERT_FAILED            : 'alerts_failed_total',
  SSE_CONNECTIONS         : 'sse_connections_active',
  REDIS_ERRORS            : 'redis_errors_total',
} as const;
