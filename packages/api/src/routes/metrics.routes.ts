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

    let workerSection = '';
    try {
      const redis = getCacheClient();
      const [counts, timestamps] = await Promise.all([
        redis.hgetall(COUNTER_HASH),
        redis.hgetall(TS_HASH),
      ]);
      const now = Math.floor(Date.now() / 1000);

      for (const [field, value] of Object.entries(counts)) {
        const n         = parseInt(value, 10);
        if (isNaN(n)) continue;
        const updatedAt  = parseInt(timestamps[field] ?? '0', 10);
        const isStale    = now - updatedAt > STALE_AFTER;
        const metricName = `pulseway_worker_${field}_total`;
        workerSection   += `# HELP ${metricName} Worker ${field} counter (aggregated across instances)\n`;
        workerSection   += `# TYPE ${metricName} counter\n`;
        // Stale counters are exported with a stale label so alerting rules can detect dead workers
        workerSection   += `${metricName}{stale="${isStale}"} ${n}\n`;
      }
    } catch {
      // Non-fatal — scraper will see empty worker section
    }

    // Scheduler last tick
    let schedulerSection = '';
    try {
      const lastTick = await redis.get('metrics:scheduler:last_tick_at');
      if (lastTick) {
        schedulerSection  = '# HELP pulseway_scheduler_last_tick_timestamp Unix timestamp of last scheduler tick\n';
        schedulerSection += '# TYPE pulseway_scheduler_last_tick_timestamp gauge\n';
        schedulerSection += `pulseway_scheduler_last_tick_timestamp ${lastTick}\n`;
      }
    } catch {
      // Non-fatal
    }

    res.setHeader('Content-Type', 'text/plain; version=0.0.4; charset=utf-8');
    res.send(renderMetrics() + workerSection + schedulerSection);
  });

  return router;
}
