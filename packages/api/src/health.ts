import type { Request, Response } from 'express';
import { getPool } from '@pulseway/db';
import { getCacheClient } from './redis.js';

// /health/live — process is running; used by container liveness probe
export function livenessHandler(_req: Request, res: Response): void {
  res.status(200).json({ status: 'ok', uptime: process.uptime() });
}

// /health/ready — all dependencies reachable; used by load balancer readiness probe
export async function readinessHandler(_req: Request, res: Response): Promise<void> {
  const checks: Record<string, 'ok' | 'error'> = { database: 'ok', redis: 'ok' };

  await Promise.allSettled([
    getPool().query('SELECT 1').catch(() => { checks.database = 'error'; }),
    getCacheClient().ping().catch(() => { checks.redis = 'error'; }),
  ]);

  const allOk  = Object.values(checks).every((v) => v === 'ok');
  res.status(allOk ? 200 : 503).json({
    status: allOk ? 'ready' : 'unavailable',
    checks,
    uptime: process.uptime(),
  });
}
