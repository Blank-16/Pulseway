import type Redis from 'ioredis';

const SCHEDULER_TS_KEY = 'metrics:scheduler:last_tick_at';

export async function recordSchedulerTick(redis: Redis): Promise<void> {
  try {
    await redis.set(SCHEDULER_TS_KEY, Math.floor(Date.now() / 1000).toString(), 'EX', 300);
  } catch {
    // Non-fatal
  }
}

export async function getSchedulerLastTick(redis: Redis): Promise<number | null> {
  try {
    const val = await redis.get(SCHEDULER_TS_KEY);
    return val ? parseInt(val, 10) : null;
  } catch {
    return null;
  }
}
