import { Router } from 'express';
import { renderMetrics, setGauge, Metrics } from '../metrics.js';
import { getCacheClient } from '../redis.js';
import type { SSEManager } from '../sse/SSEManager.js';
import type { Request, Response } from 'express';

const COUNTER_HASH = 'metrics:worker:counts';
const TS_HASH      = 'metrics:worker:updated_at';
const STALE_AFTER  = 120;

export function metricsRoutes(sseManager: SSEManager): Router {
  const router = Router();

  router.get('/', async (_req: Request, res: Response) => {
    setGauge(Metrics.SSE_CONNECTIONS, 'Active SSE connections', sseManager.totalConnections);

    // Fetch worker counters + scheduler timestamp in a single connection
    let workerSection    = '';
    let schedulerSection = '';

    try {
      const redis = getCacheClient();

      // Batch all Redis reads in one round-trip
      const [counts, timestamps, lastTick] = await Promise.all([
        redis.hgetall(COUNTER_HASH),
        redis.hgetall(TS_HASH),
        redis.get('metrics:scheduler:last_tick_at'),
      ]);

      const now = Math.floor(Date.now() / 1000);

      for (const [field, value] of Object.entries(counts ?? {})) {
        const n = parseInt(value, 10);
        if (isNaN(n)) continue;
        const updatedAt  = parseInt(timestamps?.[field] ?? '0', 10);
        const isStale    = now - updatedAt > STALE_AFTER;
        const metricName = `pulseway_worker_${field}_total`;
        workerSection   += `# HELP ${metricName} Worker ${field} counter (aggregated across instances)\n`;
        workerSection   += `# TYPE ${metricName} counter\n`;
        workerSection   += `${metricName}{stale="${String(isStale)}"} ${n}\n`;
      }

      if (lastTick) {
        schedulerSection  = '# HELP pulseway_scheduler_last_tick_timestamp Unix timestamp of last scheduler tick\n';
        schedulerSection += '# TYPE pulseway_scheduler_last_tick_timestamp gauge\n';
        schedulerSection += `pulseway_scheduler_last_tick_timestamp ${lastTick}\n`;
      }
    } catch {
      // Redis unavailable — return what we have from in-process Prometheus registry
    }

    res.setHeader('Content-Type', 'text/plain; version=0.0.4; charset=utf-8');
    res.send(renderMetrics() + workerSection + schedulerSection);
  });

  return router;
}
