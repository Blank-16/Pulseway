import { describe, it, expect, vi, beforeEach } from 'vitest';
import type Redis from 'ioredis';

function makeMockRedis() {
  const pipelineResult = { exec: vi.fn().mockResolvedValue([]) };
  return {
    pipeline  : vi.fn().mockReturnValue({
      hincrby : vi.fn().mockReturnValue(pipelineResult),
      hset    : vi.fn().mockReturnValue(pipelineResult),
      expire  : vi.fn().mockReturnValue(pipelineResult),
      exec    : vi.fn().mockResolvedValue([]),
    }),
    hset      : vi.fn().mockResolvedValue(1),
    hgetall   : vi.fn(),
  } as unknown as Redis;
}

import { WorkerMetrics, WORKER_METRIC } from '../../packages/worker/src/WorkerMetrics.js';

describe('WorkerMetrics', () => {
  let redis  : ReturnType<typeof makeMockRedis>;
  let metrics: WorkerMetrics;

  beforeEach(() => {
    redis   = makeMockRedis();
    metrics = new WorkerMetrics(redis as unknown as Redis);
  });

  it('inc uses pipeline with hincrby + hset timestamp + expire', async () => {
    const pipeline = redis.pipeline() as ReturnType<typeof vi.fn>;
    redis.pipeline = vi.fn().mockReturnValue({
      hincrby: vi.fn().mockReturnThis(),
      hset   : vi.fn().mockReturnThis(),
      expire : vi.fn().mockReturnThis(),
      exec   : vi.fn().mockResolvedValue([]),
    });

    await metrics.inc(WORKER_METRIC.CHECKS_PROCESSED);
    expect(redis.pipeline).toHaveBeenCalled();
    const p = (redis.pipeline as ReturnType<typeof vi.fn>).mock.results[0].value;
    expect(p.hincrby).toHaveBeenCalledWith('metrics:worker:counts', WORKER_METRIC.CHECKS_PROCESSED, 1);
    expect(p.hset).toHaveBeenCalled();
    expect(p.expire).toHaveBeenCalledTimes(2);
    expect(p.exec).toHaveBeenCalled();
  });

  it('inc does not throw when Redis is unavailable', async () => {
    redis.pipeline = vi.fn().mockImplementation(() => { throw new Error('Redis down'); });
    await expect(metrics.inc(WORKER_METRIC.CHECKS_FAILED)).resolves.toBeUndefined();
  });

  it('getAll marks stale counters correctly', async () => {
    const now = Math.floor(Date.now() / 1000);
    (redis.hgetall as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ checks_processed: '42', checks_failed: '3' })
      .mockResolvedValueOnce({
        checks_processed: String(now - 10),   // fresh
        checks_failed   : String(now - 200),  // stale (> 120s)
      });

    const result = await metrics.getAll();
    expect(result['checks_processed']?.stale).toBe(false);
    expect(result['checks_failed']?.stale).toBe(true);
    expect(result['checks_processed']?.value).toBe(42);
  });

  it('getAll returns empty object when Redis fails', async () => {
    (redis.hgetall as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('Redis down'));
    const result = await metrics.getAll();
    expect(result).toEqual({});
  });
});
