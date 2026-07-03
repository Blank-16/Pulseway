import type { Request, Response, NextFunction, RequestHandler } from 'express';
import { getCacheClient } from '../redis.js';
import { AppError, ErrorCode } from '../errors.js';

interface RateLimiterOptions {
  limit    : number;
  windowMs : number;
  keyPrefix?: string;
}

// Sliding-window rate limiter using a Redis sorted-set.
// Atomic via Lua — no race conditions under concurrency.
const SLIDING_WINDOW_LUA = `
local key   = KEYS[1]
local now   = tonumber(ARGV[1])
local win   = tonumber(ARGV[2])
local limit = tonumber(ARGV[3])
local floor = now - win
redis.call('ZREMRANGEBYSCORE', key, '-inf', floor)
local count = redis.call('ZCARD', key)
if count >= limit then
  return 0
end
redis.call('ZADD', key, now, now .. '-' .. math.random(1, 1000000))
redis.call('PEXPIRE', key, win)
return 1
`;

function extractClientIp(req: any): string {
  // Trust the rightmost IP added by the ALB/proxy — not the leftmost (client-spoofable).
  // Requires app.set('trust proxy', N) where N = number of trusted proxy hops.
  // req.ip already handles this correctly when trust proxy is configured.
  return req.ip ?? 'unknown';
}

export function rateLimiter(options: RateLimiterOptions): RequestHandler {
  const { limit, windowMs, keyPrefix = 'rl' } = options;

  return async (req: any, res: Response, next: NextFunction): Promise<void> => {
    const ip  = extractClientIp(req);
    const key = `${keyPrefix}:${req.path}:${ip}`;
    const now = Date.now();

    try {
      const redis  = getCacheClient();
      const result = await redis.eval(SLIDING_WINDOW_LUA, 1, key, String(now), String(windowMs), String(limit)) as number;

      const remaining = Math.max(0, limit - 1);
      res.setHeader('X-RateLimit-Limit', limit);
      res.setHeader('X-RateLimit-Remaining', result === 1 ? remaining : 0);
      res.setHeader('X-RateLimit-Reset', Math.ceil((now + windowMs) / 1000));

      if (result === 0) {
        res.setHeader('Retry-After', Math.ceil(windowMs / 1000));
        next(new AppError(429, ErrorCode.BAD_REQUEST, 'Rate limit exceeded'));
        return;
      }
    } catch {
      // Redis unavailable — fail open to avoid a Redis outage taking down the API
    }

    next();
  };
}
