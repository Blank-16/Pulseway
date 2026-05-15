import type { Response } from 'express';
import { getConfig } from '@pulseway/config';
import type { SSEEvent } from '@pulseway/types';

interface SSEConnection {
  workspaceId: string;
  res: Response;
}

export class SSEManager {
  private readonly connections = new Map<string, Set<SSEConnection>>();

  /**
   * Returns null if the per-workspace connection cap is reached.
   * Caller must respond with 429 and NOT call res.end() afterwards.
   */
  add(workspaceId: string, res: Response): (() => void) | null {
    const config  = getConfig();
    const maxConn = config.SSE_MAX_CONNECTIONS_PER_WORKSPACE;

    if (!this.connections.has(workspaceId)) {
      this.connections.set(workspaceId, new Set());
    }
    const pool = this.connections.get(workspaceId)!;

    if (pool.size >= maxConn) return null;

    const conn: SSEConnection = { workspaceId, res };
    pool.add(conn);

    const remove = (): void => {
      pool.delete(conn);
      if (pool.size === 0) this.connections.delete(workspaceId);
    };

    res.on('close', remove);
    return remove;
  }

  broadcast(workspaceId: string, event: SSEEvent): void {
    const conns = this.connections.get(workspaceId);
    if (!conns || conns.size === 0) return;

    const payload = `data: ${JSON.stringify(event)}\n\n`;
    for (const conn of conns) {
      try {
        conn.res.write(payload);
      } catch {
        // Already closed — cleanup fires via 'close' event
      }
    }
  }

  drainAll(): void {
    for (const conns of this.connections.values()) {
      for (const conn of conns) {
        try {
          conn.res.write('event: shutdown\ndata: {}\n\n');
          conn.res.end();
        } catch {
          // ignore
        }
      }
    }
    this.connections.clear();
  }

  get totalConnections(): number {
    let total = 0;
    for (const conns of this.connections.values()) total += conns.size;
    return total;
  }

  connectionCount(workspaceId: string): number {
    return this.connections.get(workspaceId)?.size ?? 0;
  }
}
