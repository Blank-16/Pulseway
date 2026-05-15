import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Redis } from 'ioredis';

vi.mock('@pulseway/db', () => ({
  IncidentRepository: vi.fn().mockImplementation(() => ({
    findOpenByMonitorId: vi.fn().mockResolvedValue(null),
    insert             : vi.fn().mockResolvedValue({ id: 'incident-1', monitorId: 'monitor-1', startedAt: new Date().toISOString(), status: 'open', acknowledgedAt: null, acknowledgedBy: null, resolvedAt: null, durationSeconds: null }),
    resolve            : vi.fn().mockResolvedValue({ id: 'incident-1', durationSeconds: 120, status: 'resolved', monitorId: 'monitor-1', startedAt: new Date().toISOString(), acknowledgedAt: null, acknowledgedBy: null, resolvedAt: new Date().toISOString() }),
    appendTimeline     : vi.fn().mockResolvedValue({}),
  })),
}));

vi.mock('@pulseway/config', () => ({
  getConfig: vi.fn().mockReturnValue({
    INCIDENT_CONSECUTIVE_FAILURES_REQUIRED: 3,
    AWS_REGION                            : 'us-east-1',
    ALERT_JOBS_QUEUE_URL                  : 'http://localhost:4566/queue/alert',
  }),
}));

vi.mock('@aws-sdk/client-sqs', () => ({
  SQSClient         : vi.fn().mockImplementation(() => ({ send: vi.fn().mockResolvedValue({}) })),
  SendMessageCommand: vi.fn(),
}));

import { IncidentEvaluator } from '../../packages/worker/src/IncidentEvaluator.js';
import { IncidentRepository } from '@pulseway/db';

function makeMockRedis(evalResult: string[]): Redis {
  return {
    eval   : vi.fn().mockResolvedValue(evalResult),
    publish: vi.fn().mockResolvedValue(1),
  } as unknown as Redis;
}

describe('IncidentEvaluator', () => {
  let incidentRepoInstance: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    incidentRepoInstance = (IncidentRepository as ReturnType<typeof vi.fn>).mock.results[0]?.value;
  });

  it('opens incident after N consecutive failures', async () => {
    const redisData = makeMockRedis(['down', 'down', 'down']);
    const redisPub  = makeMockRedis([]);
    const evaluator = new IncidentEvaluator(redisData, redisPub);

    await evaluator.evaluate('monitor-1', 'workspace-1', 'down');

    const repo = (IncidentRepository as ReturnType<typeof vi.fn>).mock.results.at(-1)?.value;
    expect(repo.insert).toHaveBeenCalledWith('monitor-1');
    expect(repo.appendTimeline).toHaveBeenCalledWith('incident-1', 'incident_opened', expect.any(String), null);
    expect(redisPub.publish).toHaveBeenCalledWith('incident-events', expect.stringContaining('incident:opened'));
  });

  it('does not open incident if threshold not yet reached', async () => {
    const redisData = makeMockRedis(['down', 'down']);
    const evaluator = new IncidentEvaluator(redisData, makeMockRedis([]));

    await evaluator.evaluate('monitor-1', 'workspace-1', 'down');

    const repo = (IncidentRepository as ReturnType<typeof vi.fn>).mock.results.at(-1)?.value;
    expect(repo.insert).not.toHaveBeenCalled();
  });

  it('does not open duplicate incident when one is already open', async () => {
    const redisData = makeMockRedis(['down', 'down', 'down']);
    const evaluator = new IncidentEvaluator(redisData, makeMockRedis([]));
    const repo      = (IncidentRepository as ReturnType<typeof vi.fn>).mock.results.at(-1)?.value;
    repo.findOpenByMonitorId.mockResolvedValue({ id: 'existing', status: 'open' });

    await evaluator.evaluate('monitor-1', 'workspace-1', 'down');

    expect(repo.insert).not.toHaveBeenCalled();
  });

  it('resolves open incident on recovery', async () => {
    const redisData = makeMockRedis(['up']);
    const redisPub  = makeMockRedis([]);
    const evaluator = new IncidentEvaluator(redisData, redisPub);
    const repo      = (IncidentRepository as ReturnType<typeof vi.fn>).mock.results.at(-1)?.value;
    repo.findOpenByMonitorId.mockResolvedValue({ id: 'incident-1', status: 'open', monitorId: 'monitor-1', startedAt: new Date().toISOString(), acknowledgedAt: null, acknowledgedBy: null, resolvedAt: null, durationSeconds: null });

    await evaluator.evaluate('monitor-1', 'workspace-1', 'up');

    expect(repo.resolve).toHaveBeenCalledWith('incident-1');
    expect(redisPub.publish).toHaveBeenCalledWith('incident-events', expect.stringContaining('incident:resolved'));
  });

  it('does not resolve if no open incident', async () => {
    const redisData = makeMockRedis(['up']);
    const evaluator = new IncidentEvaluator(redisData, makeMockRedis([]));

    await evaluator.evaluate('monitor-1', 'workspace-1', 'up');

    const repo = (IncidentRepository as ReturnType<typeof vi.fn>).mock.results.at(-1)?.value;
    expect(repo.resolve).not.toHaveBeenCalled();
  });

  it('does not open incident when recent results contain mix of up/down', async () => {
    const redisData = makeMockRedis(['down', 'up', 'down']);
    const evaluator = new IncidentEvaluator(redisData, makeMockRedis([]));

    await evaluator.evaluate('monitor-1', 'workspace-1', 'down');

    const repo = (IncidentRepository as ReturnType<typeof vi.fn>).mock.results.at(-1)?.value;
    expect(repo.insert).not.toHaveBeenCalled();
  });
});
