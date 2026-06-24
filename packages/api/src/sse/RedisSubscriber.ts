import { getPool } from '@pulseway/db';
import { getSubscribeClient, closeAllRedisConnections } from '../redis.js';
import type { SSEManager } from './SSEManager.js';
import type { SSEEvent } from '@pulseway/types';
import { logger } from '../logger.js';

const CHANNELS = ['check-events', 'incident-events'] as const;

// Bounded LRU-style workspace ID cache.
// monitorId → workspaceId; capped at MAX_CACHE_SIZE entries to prevent
// unbounded growth if the system has thousands of monitors.
const MAX_CACHE_SIZE     = 2_000;
const workspaceIdCache   = new Map<string, string>();

function cacheGet(monitorId: string): string | undefined {
  return workspaceIdCache.get(monitorId);
}

function cacheSet(monitorId: string, workspaceId: string): void {
  if (workspaceIdCache.size >= MAX_CACHE_SIZE) {
    // Evict the oldest entry (Maps preserve insertion order)
    const firstKey = workspaceIdCache.keys().next().value;
    if (firstKey !== undefined) workspaceIdCache.delete(firstKey);
  }
  workspaceIdCache.set(monitorId, workspaceId);
}

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

    redis.on('error', (err) =>
      logger.error({ err }, 'RedisSubscriber connection error'),
    );

    logger.info({ channels: CHANNELS }, 'RedisSubscriber connected');
  }

  async disconnect(): Promise<void> {
    await closeAllRedisConnections();
  }

  private async handleMessage(raw: string): Promise<void> {
    let parsed: SSEEvent & { workspaceId?: string };
    try {
      parsed = JSON.parse(raw) as SSEEvent & { workspaceId?: string };
    } catch (err) {
      logger.warn({ err, raw: raw.slice(0, 200) }, 'RedisSubscriber: malformed message — discarding');
      return;
    }

    let workspaceId = parsed.workspaceId;

    if (!workspaceId) {
      const data      = parsed.data as Record<string, unknown> | undefined;
      const monitorId = data?.['monitorId'] as string | undefined;
      if (monitorId) {
        workspaceId = await this.resolveWorkspaceId(monitorId);
      }
    }

    if (!workspaceId) {
      logger.debug({ eventType: parsed.type }, 'RedisSubscriber: could not resolve workspaceId — skipping broadcast');
      return;
    }

    this.sseManager.broadcast(workspaceId, parsed);
  }

  private async resolveWorkspaceId(monitorId: string): Promise<string | undefined> {
    const cached = cacheGet(monitorId);
    if (cached) return cached;

    try {
      const { rows } = await getPool().query<{ workspace_id: string }>(
        'SELECT workspace_id FROM monitors WHERE id = $1 AND deleted_at IS NULL',
        [monitorId],
      );
      const workspaceId = rows[0]?.workspace_id;
      if (workspaceId) cacheSet(monitorId, workspaceId);
      return workspaceId;
    } catch (err) {
      logger.error({ err, monitorId }, 'RedisSubscriber: DB lookup for workspace_id failed');
      return undefined;
    }
  }
}
