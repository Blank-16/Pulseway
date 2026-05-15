import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response, NextFunction } from 'express';

const mockGetConfig = vi.fn();
vi.mock('@pulseway/config', () => ({ getConfig: mockGetConfig }));

import { metricsAuth } from '../../packages/api/src/middleware/metrics-auth.js';

function makeCtx(authHeader?: string, nodeEnv = 'production') {
  mockGetConfig.mockReturnValue({ METRICS_TOKEN: 'secure-token-32-chars-long-xxxx', NODE_ENV: nodeEnv });
  const req  = { headers: authHeader ? { authorization: authHeader } : {} } as unknown as Request;
  const res  = {} as Response;
  const next = vi.fn() as NextFunction;
  return { req, res, next };
}

describe('metricsAuth', () => {
  it('allows request with correct bearer token', () => {
    const { req, res, next } = makeCtx('Bearer secure-token-32-chars-long-xxxx');
    metricsAuth()(req, res, next);
    expect(next).toHaveBeenCalledWith();
  });

  it('rejects request with wrong token', () => {
    const { req, res, next } = makeCtx('Bearer wrong-token');
    metricsAuth()(req, res, next);
    const err = (next as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];
    expect(err?.statusCode).toBe(401);
  });

  it('rejects request with no authorization header', () => {
    const { req, res, next } = makeCtx(undefined);
    metricsAuth()(req, res, next);
    const err = (next as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];
    expect(err?.statusCode).toBe(401);
  });

  it('allows unauthenticated access in development when no token configured', () => {
    mockGetConfig.mockReturnValue({ METRICS_TOKEN: undefined, NODE_ENV: 'development' });
    const req  = { headers: {} } as unknown as Request;
    const res  = {} as Response;
    const next = vi.fn() as NextFunction;
    metricsAuth()(req, res, next);
    expect(next).toHaveBeenCalledWith();
  });

  it('rejects in production when METRICS_TOKEN is not set', () => {
    mockGetConfig.mockReturnValue({ METRICS_TOKEN: undefined, NODE_ENV: 'production' });
    const req  = { headers: {} } as unknown as Request;
    const res  = {} as Response;
    const next = vi.fn() as NextFunction;
    metricsAuth()(req, res, next);
    const err = (next as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];
    expect(err?.statusCode).toBe(403);
  });
});
