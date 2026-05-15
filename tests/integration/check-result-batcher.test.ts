import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mockQuery = vi.fn();
vi.mock('@pulseway/db/src/client.js', () => ({
  getPool: () => ({ query: mockQuery }),
}));
vi.mock('@pulseway/db', () => ({
  getPool: () => ({ query: mockQuery }),
}));

import { CheckResultBatcher } from '../../packages/db/src/repositories/CheckResultBatcher.js';

function makeRow(monitorId = 'monitor-1') {
  return { monitorId, status: 'up', statusCode: 200, responseTimeMs: 42, errorMessage: null, region: 'us-east-1' };
}

describe('CheckResultBatcher', () => {
  beforeEach(() => {
    mockQuery.mockResolvedValue({ rows: [{ id: 'row-1', monitor_id: 'monitor-1' }] });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('batches multiple enqueues into a single INSERT', async () => {
    const batcher = new CheckResultBatcher();
    const p1 = batcher.enqueue(makeRow());
    const p2 = batcher.enqueue(makeRow());
    await batcher.drain();
    await Promise.all([p1, p2]);

    expect(mockQuery).toHaveBeenCalledTimes(1);
    const sql = mockQuery.mock.calls[0][0] as string;
    expect(sql).toContain('INSERT INTO check_results');
    expect(sql).toContain('$7'); // Second row starts at $7
  });

  it('resolves each enqueue promise on successful insert', async () => {
    mockQuery.mockResolvedValue({
      rows: [
        { id: 'r1', monitor_id: 'monitor-1' },
        { id: 'r2', monitor_id: 'monitor-1' },
      ],
    });
    const batcher = new CheckResultBatcher();
    const results = await Promise.all([
      batcher.enqueue(makeRow()),
      batcher.enqueue(makeRow()),
      batcher.drain(),
    ]);
    expect(results).toBeDefined();
  });

  it('rejects enqueue promises on DB error', async () => {
    mockQuery.mockRejectedValue(new Error('DB error'));
    const batcher = new CheckResultBatcher();
    const p = batcher.enqueue(makeRow());
    await batcher.drain();
    await expect(p).rejects.toThrow('DB error');
  });

  it('drain() awaits in-flight inserts before returning', async () => {
    let resolveQuery!: () => void;
    mockQuery.mockReturnValue(
      new Promise<{ rows: { id: string; monitor_id: string }[] }>((res) => {
        resolveQuery = () => res({ rows: [{ id: 'r1', monitor_id: 'monitor-1' }] });
      }),
    );
    const batcher = new CheckResultBatcher();
    batcher.enqueue(makeRow());
    const drainPromise = batcher.drain();
    let drained = false;
    drainPromise.then(() => { drained = true; });

    // Drain should not resolve before the in-flight query resolves
    await new Promise((r) => setTimeout(r, 10));
    expect(drained).toBe(false);

    resolveQuery();
    await drainPromise;
    expect(drained).toBe(true);
  });
});
