import type { Request, Response, NextFunction, RequestHandler } from 'express';
import { getConfig } from '@pulseway/config';
import { AppError, ErrorCode } from '../errors.js';

/**
 * Guards /metrics with a static bearer token.
 * Set METRICS_TOKEN in env; scraper (Prometheus, Datadog agent) sends it as Authorization header.
 */
export function metricsAuth(): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const config = getConfig();
    // If no token is configured, allow only in non-production
    if (!config.METRICS_TOKEN) {
      if (config.NODE_ENV !== 'production') { next(); return; }
      next(new AppError(403, ErrorCode.FORBIDDEN, 'Metrics endpoint requires METRICS_TOKEN in production'));
      return;
    }

    const authHeader = req.headers['authorization'] ?? '';
    const token      = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';

    if (!token || token !== config.METRICS_TOKEN) {
      next(new AppError(401, ErrorCode.UNAUTHORIZED, 'Metrics: invalid or missing token'));
      return;
    }

    next();
  };
}
