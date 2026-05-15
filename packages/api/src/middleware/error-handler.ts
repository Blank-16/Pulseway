import type { Request, Response, NextFunction } from 'express';
import { AppError } from '../errors.js';
import { logger } from '../logger.js';

export { AppError } from '../errors.js';

export function errorHandler(
  err: unknown,
  req: Request,
  res: Response,
  _next: NextFunction,
): void {
  if (err instanceof AppError) {
    if (err.statusCode >= 500) {
      (req.log ?? logger).error({ err, requestId: req.id }, err.message);
    } else {
      (req.log ?? logger).warn({ code: err.code, path: req.path }, err.message);
    }
    res.status(err.statusCode).json({
      error: { code: err.code, message: err.message, ...(err.details ? { details: err.details } : {}) },
    });
    return;
  }

  (req.log ?? logger).error({ err, requestId: req.id, path: req.path }, 'Unhandled error');
  res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' } });
}
