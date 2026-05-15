import Redis from 'ioredis';
import { getConfig } from '@pulseway/config';
import { logger } from './logger.js';

let publishClient: Redis | null = null;
let subscribeClient: Redis | null = null;
let cacheClient: Redis | null = null;

function makeClient(name: string): Redis {
  const redis = new Redis(getConfig().REDIS_URL, {
    lazyConnect: false,
    maxRetriesPerRequest: 3,
    enableReadyCheck: true,
    connectionName: `pulseway-${name}`,
    retryStrategy(times) {
      return Math.min(times * 200, 10_000);
    },
  });

  redis.on('error', (err) => logger.error({ err, client: name }, 'Redis error'));
  redis.on('reconnecting', () => logger.warn({ client: name }, 'Redis reconnecting'));

  return redis;
}

// Pub client — for publishing events (cannot be used for subscribe)
export function getPublishClient(): Redis {
  if (!publishClient) publishClient = makeClient('publish');
  return publishClient;
}

// Subscribe client — dedicated connection (Redis protocol requires exclusive use)
export function getSubscribeClient(): Redis {
  if (!subscribeClient) subscribeClient = makeClient('subscribe');
  return subscribeClient;
}

// Cache/data client — get/set/expire operations
export function getCacheClient(): Redis {
  if (!cacheClient) cacheClient = makeClient('cache');
  return cacheClient;
}

export async function closeAllRedisConnections(): Promise<void> {
  await Promise.allSettled([
    publishClient?.quit(),
    subscribeClient?.quit(),
    cacheClient?.quit(),
  ]);
  publishClient = null;
  subscribeClient = null;
  cacheClient = null;
}
