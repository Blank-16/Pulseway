import type { Request, Response, NextFunction, RequestHandler } from 'express';
import type { AuthenticatedRequest } from './authenticate.js';

type AsyncHandler<TReq extends Request = Request> = (
  req: TReq,
  res: Response,
  next: NextFunction,
) => Promise<void> | void;

/**
 * Wraps an async route handler so Express 5's built-in async error propagation
 * still works, while giving TypeScript the correct inferred type for req.
 * Eliminates the need for 'as never' / 'as unknown' casts throughout routes.
 */
export function handler(fn: AsyncHandler<Request>): RequestHandler {
  return fn as RequestHandler;
}

export function authHandler(fn: AsyncHandler<AuthenticatedRequest>): RequestHandler {
  return fn as RequestHandler;
}
