import type { Request, Response } from 'express';
import { checkPoolHealth } from '@pulseway/db';
import { getCacheClient } from './redis.js';
import { logger } from './logger.js';

/** Liveness probe — returns 200 as long as the process is alive. */
export function livenessHandler(_req: Request, res: Response): void {
  res.status(200).json({ status: 'ok', uptime: process.uptime() });
}

/**
 * Readiness probe — returns 200 only when Postgres and Redis are reachable.
 * Used by the load balancer / ACA ingress to decide whether to route traffic.
 * Should return within 5 seconds (hard constraint from HEALTHCHECK config).
 */
export async function readinessHandler(_req: Request, res: Response): Promise<void> {
  const checks: Record<string, 'ok' | 'error'> = { database: 'ok', redis: 'ok' };

  await Promise.allSettled([
    checkPoolHealth().then((ok) => { if (!ok) checks['database'] = 'error'; }),
    getCacheClient().ping().then((reply) => {
      if (reply !== 'PONG') checks['redis'] = 'error';
    }).catch(() => { checks['redis'] = 'error'; }),
  ]);

  const allOk = Object.values(checks).every((v) => v === 'ok');

  if (!allOk) {
    logger.warn({ checks }, '/health/ready: dependency check failed');
  }

  res.status(allOk ? 200 : 503).json({
    status  : allOk ? 'ready' : 'unavailable',
    checks,
    uptime  : process.uptime(),
    // npm_package_version is injected by Node.js from package.json — not a config var
    version : process.env['npm_package_version'] ?? 'unknown',
  });
}
