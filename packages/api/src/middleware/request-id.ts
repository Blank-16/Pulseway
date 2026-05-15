import { randomUUID } from 'node:crypto';
import type { Request, Response, NextFunction, RequestHandler } from 'express';
import { logger } from '../logger.js';

declare global {
  namespace Express {
    interface Request {
      id: string;
      log: typeof logger;
    }
  }
}

export function requestId(): RequestHandler {
  return (req: Request, res: Response, next: NextFunction): void => {
    const id = (req.headers['x-request-id'] as string | undefined) ?? randomUUID();
    req.id = id;
    req.log = logger.child({ requestId: id });
    res.setHeader('X-Request-Id', id);
    next();
  };
}
