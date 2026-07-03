import { randomUUID } from 'node:crypto';
import type { Request, Response, NextFunction, RequestHandler } from 'express';
import { trace, context } from '@opentelemetry/api';

declare module 'express' {
  interface Request {
    id: string;
  }
}

export function requestId(): RequestHandler {
  return (req: any, _res: Response, next: NextFunction): void => {
    req.id = (req.headers['x-request-id'] as string | undefined) ?? randomUUID();

    // Attach OTEL trace/span IDs to the request so pino-http can pick them up
    const span    = trace.getActiveSpan();
    const spanCtx = span?.spanContext();
    if (spanCtx) {
      (req as Request & { traceId: string; spanId: string }).traceId = spanCtx.traceId;
      (req as Request & { traceId: string; spanId: string }).spanId  = spanCtx.spanId;
    }

    next();
  };
}
