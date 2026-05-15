import { getSubscribeClient, closeAllRedisConnections } from '../redis.js';
import type { SSEManager } from './SSEManager.js';
import type { SSEEvent } from '@pulseway/types';
import { logger } from '../logger.js';

const CHANNELS = ['check-events', 'incident-events'] as const;

export class RedisSubscriber {
  constructor(private readonly sseManager: SSEManager) {}

  async connect(): Promise<void> {
    const redis = getSubscribeClient();
    await redis.subscribe(...CHANNELS);

    redis.on('message', (_channel: string, message: string) => {
      this.handleMessage(message).catch((err) =>
        logger.error({ err }, 'SSE relay error'),
      );
    });

    logger.info({ channels: CHANNELS }, 'RedisSubscriber connected');
  }

  async disconnect(): Promise<void> {
    await closeAllRedisConnections();
  }

  private readonly workspaceCache = new Map<string, string>();

  private async handleMessage(raw: string): Promise<void> {
    const event = JSON.parse(raw) as SSEEvent & { workspaceId?: string };
    let workspaceId = event.workspaceId;

    if (!workspaceId) {
      const monitorId = (event.data as Record<string, unknown>)['monitorId'] as string | undefined;
      if (monitorId) workspaceId = await this.resolveWorkspaceId(monitorId);
    }

    if (!workspaceId) return;
    this.sseManager.broadcast(workspaceId, event);
  }

  private async resolveWorkspaceId(monitorId: string): Promise<string | undefined> {
    const cached = this.workspaceCache.get(monitorId);
    if (cached) return cached;

    const { getPool } = await import('@pulseway/db');
    const { rows } = await getPool().query<{ workspace_id: string }>(
      'SELECT workspace_id FROM monitors WHERE id = $1',
      [monitorId],
    );

    const workspaceId = rows[0]?.workspace_id;
    if (workspaceId) this.workspaceCache.set(monitorId, workspaceId);
    return workspaceId;
  }
}
