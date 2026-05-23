/**
 * k6 load test — check pipeline throughput baseline.
 * Run: k6 run tests/load/check-pipeline.js
 *
 * Requires a running API at $API_URL (default http://localhost:4000)
 * with a seeded workspace and access token set in API_TOKEN env var.
 *
 * k6 install: https://k6.io/docs/get-started/installation/
 */
import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate, Trend, Counter } from 'k6/metrics';

const errorRate     = new Rate('errors');
const responseTimes = new Trend('response_time_ms', true);
const monitorCalls  = new Counter('monitor_api_calls');

const API_URL    = __ENV.API_URL    ?? 'http://localhost:4000';
const API_TOKEN  = __ENV.API_TOKEN  ?? '';
const WS_ID      = __ENV.WORKSPACE_ID ?? '';

export const options = {
  scenarios: {
    // Ramp up to 50 VUs over 1 minute, hold for 3 minutes, ramp down
    sustained_load: {
      executor       : 'ramping-vus',
      startVUs       : 0,
      stages         : [
        { duration: '1m', target: 50  },
        { duration: '3m', target: 50  },
        { duration: '1m', target: 0   },
      ],
    },
  },
  thresholds: {
    http_req_duration       : ['p(99)<500'],   // p99 < 500ms
    http_req_failed         : ['rate<0.01'],   // < 1% errors
    errors                  : ['rate<0.01'],
  },
};

export default function () {
  const headers = {
    'Authorization': `Bearer ${API_TOKEN}`,
    'Content-Type' : 'application/json',
  };

  // List monitors
  const listRes = http.get(`${API_URL}/api/monitors/workspace/${WS_ID}`, { headers });
  check(listRes, { 'list monitors 200': (r) => r.status === 200 });
  errorRate.add(listRes.status !== 200);
  responseTimes.add(listRes.timings.duration);
  monitorCalls.add(1);

  // List incidents
  const incRes = http.get(`${API_URL}/api/incidents/workspace/${WS_ID}`, { headers });
  check(incRes, { 'list incidents 200': (r) => r.status === 200 });
  errorRate.add(incRes.status !== 200);

  // Health check
  const healthRes = http.get(`${API_URL}/health/ready`);
  check(healthRes, { 'health ready': (r) => r.status === 200 });

  sleep(1);
}

export function handleSummary(data) {
  return {
    'tests/load/results/summary.json': JSON.stringify(data, null, 2),
    stdout: `
=== Load Test Summary ===
p50 response time : ${data.metrics.http_req_duration?.values?.['p(50)']?.toFixed(0) ?? 'N/A'}ms
p95 response time : ${data.metrics.http_req_duration?.values?.['p(95)']?.toFixed(0) ?? 'N/A'}ms
p99 response time : ${data.metrics.http_req_duration?.values?.['p(99)']?.toFixed(0) ?? 'N/A'}ms
error rate        : ${((data.metrics.http_req_failed?.values?.rate ?? 0) * 100).toFixed(2)}%
total requests    : ${data.metrics.http_reqs?.values?.count ?? 0}
`,
  };
}
