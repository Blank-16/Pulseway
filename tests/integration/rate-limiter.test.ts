import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response, NextFunction } from 'express';

const mockEval = vi.fn();
vi.mock('../packages/api/src/redis.js', () => ({
  getCacheClient: () => ({ eval: mockEval }),
}));
vi.mock('@pulseway/config', () => ({ getConfig: vi.fn().mockReturnValue({ NODE_ENV: 'test' }) }));

import { rateLimiter } from '../../packages/api/src/middleware/rate-limiter.js';

function makeReqRes(ip = '1.2.3.4') {
  const headers: Record<string, string> = {};
  const res = {
    setHeader: vi.fn(),
    status   : vi.fn().mockReturnThis(),
    json     : vi.fn(),
  } as unknown as Response;
  const req = { ip, path: '/api/monitors', headers } as unknown as Request;
  const next = vi.fn() as NextFunction;
  return { req, res, next };
}

describe('rateLimiter middleware', () => {
  beforeEach(() => vi.clearAllMocks());

  it('calls next when under limit', async () => {
    mockEval.mockResolvedValue(1);
    const mw = rateLimiter({ limit: 10, windowMs: 60_000 });
    const { req, res, next } = makeReqRes();
    await mw(req, res, next);
    expect(next).toHaveBeenCalledWith();
  });

  it('calls next(AppError) when limit exceeded', async () => {
    mockEval.mockResolvedValue(0);
    const mw = rateLimiter({ limit: 10, windowMs: 60_000 });
    const { req, res, next } = makeReqRes();
    await mw(req, res, next);
    const err = (next as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(err).toBeTruthy();
    expect(err.statusCode).toBe(429);
  });

  it('fails open (calls next) when Redis throws', async () => {
    mockEval.mockRejectedValue(new Error('Redis down'));
    const mw = rateLimiter({ limit: 10, windowMs: 60_000 });
    const { req, res, next } = makeReqRes();
    await mw(req, res, next);
    expect(next).toHaveBeenCalledWith();
  });
});
