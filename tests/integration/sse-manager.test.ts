import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Response } from 'express';

vi.mock('@pulseway/config', () => ({
  getConfig: vi.fn().mockReturnValue({ SSE_MAX_CONNECTIONS_PER_WORKSPACE: 3 }),
}));

import { SSEManager } from '../../packages/api/src/sse/SSEManager.js';

function makeRes(): Response {
  const listeners: Record<string, Array<() => void>> = {};
  return {
    write  : vi.fn().mockReturnValue(true),
    end    : vi.fn(),
    on     : (event: string, cb: () => void) => { (listeners[event] ??= []).push(cb); },
    emit   : (event: string) => listeners[event]?.forEach((cb) => cb()),
    _listeners: listeners,
  } as unknown as Response;
}

describe('SSEManager', () => {
  let manager: SSEManager;

  beforeEach(() => { manager = new SSEManager(); });

  it('add returns a remove function for a new connection', () => {
    const res    = makeRes();
    const remove = manager.add('ws-1', res);
    expect(remove).toBeTypeOf('function');
    expect(manager.connectionCount('ws-1')).toBe(1);
  });

  it('remove decrements the connection count', () => {
    const res    = makeRes();
    const remove = manager.add('ws-1', res)!;
    remove();
    expect(manager.connectionCount('ws-1')).toBe(0);
  });

  it('returns null when per-workspace cap is reached', () => {
    for (let i = 0; i < 3; i++) manager.add('ws-cap', makeRes());
    const result = manager.add('ws-cap', makeRes());
    expect(result).toBeNull();
    expect(manager.connectionCount('ws-cap')).toBe(3);
  });

  it('cleans up when response emits close', () => {
    const res = makeRes() as Response & { _listeners: Record<string, Array<() => void>> };
    manager.add('ws-close', res);
    expect(manager.connectionCount('ws-close')).toBe(1);
    (res as unknown as { _listeners: Record<string, Array<() => void>> })._listeners['close']?.[0]?.();
    expect(manager.connectionCount('ws-close')).toBe(0);
  });

  it('broadcast writes to all connections for a workspace', () => {
    const res1 = makeRes();
    const res2 = makeRes();
    manager.add('ws-bc', res1);
    manager.add('ws-bc', res2);

    manager.broadcast('ws-bc', { type: 'check:completed', data: {}, workspaceId: 'ws-bc' });

    expect(res1.write).toHaveBeenCalledWith(expect.stringContaining('check:completed'));
    expect(res2.write).toHaveBeenCalledWith(expect.stringContaining('check:completed'));
  });

  it('broadcast does not throw for a workspace with no connections', () => {
    expect(() => manager.broadcast('ws-none', { type: 'check:completed', data: {}, workspaceId: 'ws-none' })).not.toThrow();
  });

  it('totalConnections sums across all workspaces', () => {
    manager.add('ws-a', makeRes());
    manager.add('ws-a', makeRes());
    manager.add('ws-b', makeRes());
    expect(manager.totalConnections).toBe(3);
  });

  it('drainAll ends all connections and clears state', () => {
    const res1 = makeRes();
    const res2 = makeRes();
    manager.add('ws-drain', res1);
    manager.add('ws-drain', res2);
    manager.drainAll();
    expect(manager.totalConnections).toBe(0);
    expect(res1.end).toHaveBeenCalled();
    expect(res2.end).toHaveBeenCalled();
  });
});
