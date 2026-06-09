# Service Level Objectives

These SLOs define the reliability targets for Pulseway. All alerting thresholds in
`monitoring/alerts.yaml` are derived from the error budgets below.

---

## SLO 1 — API Availability

**Target:** 99.9% over any rolling 30-day window

**Error budget:** 43.2 minutes of downtime per month (30 × 24 × 60 × 0.001)

**Measurement:**
- Probe: `GET /health/ready` every 30 seconds from Azure Front Door health checks
- Window: 30-day rolling
- SLI: `successful_probes / total_probes`

**Alert threshold:** Fire when projected availability drops below 99.9% with >10 minutes
of budget remaining (burn rate > 6× over 1 hour, or > 3× over 6 hours).

---

## SLO 2 — Check Pipeline Latency

**Target:** 95% of monitors checked within 110% of their configured interval over any
rolling 24-hour window.

Examples:
- 60s interval monitor: 95% of checks fire within 66 seconds
- 300s interval monitor: 95% of checks fire within 330 seconds

**Error budget:** 5% of check cycles per day may exceed the 110% threshold

**Measurement:**
- SLI: `(NOW() - last_checked_at) / check_interval_seconds`
- Query: `SELECT percentile_cont(0.95) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (NOW() - last_checked_at)) / check_interval_seconds) FROM monitors WHERE is_active = true`

**Alert threshold:** Fire when p95 ratio exceeds 1.2 (120% of interval) for > 5 minutes.
This indicates scheduler lock contention, worker starvation, or SQS/Service Bus backlog.

---

## SLO 3 — Alert Delivery

**Target:** 99% of alerts delivered within 5 minutes of incident open

**Error budget:** 1% of alerts (roughly 1 in 100) may be delayed or failed

**Measurement:**
- SLI: `alerts_delivered_within_5min / total_alerts_attempted`
- Alert log query: `SELECT COUNT(*) FILTER (WHERE delivered_at - created_at <= INTERVAL '5 minutes') / COUNT(*)::float FROM alert_logs WHERE created_at >= NOW() - INTERVAL '7 days'`

**Alert threshold:** Fire when the DLQ depth > 0 for > 1 minute (messages that exhausted
retries and were not delivered).

---

## SLO 4 — API Response Time

**Target:** p99 response time < 500ms for all API endpoints over any rolling 1-hour window

**Error budget:** 1% of requests may exceed 500ms

**Measurement:**
- SLI: `requests_under_500ms / total_requests`
- Source: Azure Monitor `RespondTime` metric on Container Apps

**Alert threshold:** Fire when p99 exceeds 2000ms (4× the SLO) for > 3 minutes.
The 2s threshold gives a buffer; sustained p99 at 2s indicates a systemic issue
rather than a single slow request.

---

## SLO 5 — Incident Detection Latency

**Target:** 99% of service failures detected (incident opened) within 3 consecutive
check intervals of the first failing check.

Examples:
- 60s interval: incident opened within 3 minutes of outage start
- 300s interval: incident opened within 15 minutes

**Error budget:** 1% of incidents may be detected late (scheduler down, worker starvation)

**Measurement:**
- SLI: Derived from `incidents.started_at` vs the first `check_results` row with `status='down'`
  for that monitor within the same time window
- This requires a custom query — not surfaced in Prometheus by default

---

## Error Budget Policy

When an error budget is > 50% consumed for the month:
- No new features that touch the affected service
- P0 bugs and reliability work take priority over product work

When an error budget is 100% consumed (SLO breached):
- Incident post-mortem required within 48 hours
- Freeze on non-critical deployments until root cause is fixed
- Reliability review with engineering lead

---

## Alerting Rule Mapping

| SLO | Prometheus/Azure Monitor Alert | File |
|---|---|---|
| API Availability | `APIHealthCheckFailing` | `monitoring/alerts.yaml` |
| API Availability | `APIHighErrorRate` | `monitoring/alerts.yaml` |
| Check Pipeline | `SchedulerLockNotRefreshed`, `WorkerStaleMetrics` | `monitoring/alerts.yaml` |
| Alert Delivery | `DQLQueueDepthHigh` | `monitoring/alerts.yaml` |
| API Response Time | `APIHighP99Latency` | `monitoring/alerts.yaml` |
| Alert Delivery | `api_5xx` (Azure Monitor) | `infrastructure/azure/modules/monitoring/main.tf` |
| API Response Time | `api_latency` (Azure Monitor) | `infrastructure/azure/modules/monitoring/main.tf` |
| Worker Down | `worker_down` (Azure Monitor) | `infrastructure/azure/modules/monitoring/main.tf` |

---

## Revision History

| Date | Author | Change |
|---|---|---|
| Initial | Engineering | First SLO definition |
