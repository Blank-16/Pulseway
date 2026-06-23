import type { Request, Response, NextFunction } from 'express';
import { AppError } from '../errors.js';
import { logger } from '../logger.js';
import { getConfig } from '@pulseway/config';

export { AppError } from '../errors.js';

export function errorHandler(
  err    : unknown,
  req    : Request,
  res    : Response,
  _next  : NextFunction,
): void {
  const requestId = (req as Request & { id?: string }).id;

  if (err instanceof AppError) {
    if (err.statusCode >= 500) {
      (req.log ?? logger).error(
        { err, requestId, path: req.path, method: req.method },
        err.message,
      );
    } else {
      (req.log ?? logger).warn(
        { code: err.code, path: req.path, method: req.method, statusCode: err.statusCode },
        err.message,
      );
    }

    res.status(err.statusCode).json({
      error: {
        code      : err.code,
        message   : err.message,
        requestId,
        // details only included in non-production OR for non-server errors
        // (avoids leaking internal state on 5xx in production)
        ...(err.details && (err.statusCode < 500 || getConfig().NODE_ENV !== 'production')
          ? { details: err.details }
          : {}),
      },
    });
    return;
  }

  // Handle Zod errors that bubble up without being caught in validateBody
  if (err && typeof err === 'object' && 'name' in err && (err as { name: string }).name === 'ZodError') {
    (req.log ?? logger).warn({ err, requestId, path: req.path }, 'Unhandled ZodError');
    res.status(422).json({
      error: { code: 'VALIDATION_FAILED', message: 'Validation failed', requestId },
    });
    return;
  }

  // pg unique violation — surface as 409 instead of 500
  if (err && typeof err === 'object' && 'code' in err && (err as { code: string }).code === '23505') {
    res.status(409).json({
      error: { code: 'CONFLICT', message: 'Resource already exists', requestId },
    });
    return;
  }

  // pg foreign key violation — 422
  if (err && typeof err === 'object' && 'code' in err && (err as { code: string }).code === '23503') {
    res.status(422).json({
      error: { code: 'BAD_REQUEST', message: 'Referenced resource does not exist', requestId },
    });
    return;
  }

  (req.log ?? logger).error(
    { err, requestId, path: req.path, method: req.method },
    'Unhandled error',
  );

  // Never include stack trace or internal error details in production 500 responses
  res.status(500).json({
    error: {
      code     : 'INTERNAL_ERROR',
      message  : 'An unexpected error occurred',
      requestId,
    },
  });
}
