import pino from 'pino';

const redisLogger = pino({ level: 'warn', base: { service: 'worker-redis' } });
import Redis from 'ioredis';
import { getConfig } from '@pulseway/config';

let dataClient: Redis | null = null;
let pubClient: Redis | null = null;

function makeClient(name: string): Redis {
  const redis = new Redis(getConfig().REDIS_URL, {
    lazyConnect: false,
    maxRetriesPerRequest: 3,
    connectionName: `pulseway-worker-${name}`,
    retryStrategy: (times) => Math.min(times * 200, 10_000),
  });
  redis.on('error', (err) => redisLogger.error({ err, name }, 'Redis client error'));
  return redis;
}

export function getDataClient(): Redis {
  if (!dataClient) dataClient = makeClient('data');
  return dataClient;
}

export function getPubClient(): Redis {
  if (!pubClient) pubClient = makeClient('pub');
  return pubClient;
}

export async function closeWorkerRedis(): Promise<void> {
  await Promise.allSettled([dataClient?.quit(), pubClient?.quit()]);
  dataClient = null;
  pubClient = null;
}
