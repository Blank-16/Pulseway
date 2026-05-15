import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { ErrorCode } from '../errors.js';

export function validateBody<T extends z.ZodTypeAny>(schema: T) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      res.status(422).json({
        error: {
          code: ErrorCode.VALIDATION_FAILED,
          message: 'Validation failed',
          details: result.error.flatten().fieldErrors,
        },
      });
      return;
    }
    req.body = result.data;
    next();
  };
}

export function validateQuery<T extends z.ZodTypeAny>(schema: T) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.query);
    if (!result.success) {
      res.status(422).json({
        error: {
          code: ErrorCode.VALIDATION_FAILED,
          message: 'Validation failed',
          details: result.error.flatten().fieldErrors,
        },
      });
      return;
    }
    req.query = result.data;
    next();
  };
}
