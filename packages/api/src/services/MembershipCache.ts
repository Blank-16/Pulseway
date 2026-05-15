import type { MemberRole } from '@pulseway/types';
import { WorkspaceRepository } from '@pulseway/db';
import { getCacheClient } from '../redis.js';
import { Singleflight } from '../lib/Singleflight.js';

const CACHE_TTL_SECONDS = 60;
const workspaceRepo = new WorkspaceRepository();
const sf = new Singleflight();

export async function getMemberRole(userId: string, workspaceId: string): Promise<MemberRole | null> {
  const cacheKey = `rbac:${userId}:${workspaceId}`;

  try {
    const cached = await getCacheClient().get(cacheKey);
    if (cached === 'null') return null;
    if (cached) return cached as MemberRole;
  } catch {
    // Redis failure — fall through to DB
  }

  // Singleflight: all concurrent requests for the same key share one DB query
  return sf.do(cacheKey, async () => {
    const membership = await workspaceRepo.findMember(userId, workspaceId);
    const role = membership?.role ?? null;
    try {
      await getCacheClient().setex(cacheKey, CACHE_TTL_SECONDS, role ?? 'null');
    } catch {
      // Non-fatal
    }
    return role;
  });
}

export async function invalidateMembershipCache(userId: string, workspaceId: string): Promise<void> {
  try {
    await getCacheClient().del(`rbac:${userId}:${workspaceId}`);
  } catch {
    // Non-fatal
  }
}
