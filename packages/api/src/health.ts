import type { Request, Response } from 'express';
import { getPool } from '@pulseway/db';
import { getCacheClient } from '../redis.js';

interface HealthStatus {
  status: 'ok' | 'degraded' | 'unhealthy';
  uptime: number;
  checks: {
    database: 'ok' | 'error';
    redis: 'ok' | 'error';
  };
}

export async function healthHandler(req: Request, res: Response): Promise<void> {
  const checks: HealthStatus['checks'] = { database: 'ok', redis: 'ok' };

  await Promise.allSettled([
    getPool().query('SELECT 1').catch(() => { checks.database = 'error'; }),
    getCacheClient().ping().catch(() => { checks.redis = 'error'; }),
  ]);

  const allOk  = checks.database === 'ok' && checks.redis === 'ok';
  const status : HealthStatus['status'] = allOk ? 'ok' : 'degraded';
  const httpStatus = allOk ? 200 : 503;

  res.status(httpStatus).json({ status, uptime: process.uptime(), checks });
}
