import type { MemberRole } from '@pulseway/types';
import { WorkspaceRepository } from '@pulseway/db';
import { getCacheClient } from '../redis.js';
import { Singleflight } from '../lib/Singleflight.js';

const CACHE_TTL_SECONDS      = 60;
// Cache null results with a shorter TTL to prevent DB hammering on
// repeated non-member requests (e.g. enumeration attacks)
const NEGATIVE_CACHE_TTL_SEC = 30;
const NULL_SENTINEL          = '__null__';

const workspaceRepo = new WorkspaceRepository();
const sf            = new Singleflight();

export async function getMemberRole(userId: string, workspaceId: string): Promise<MemberRole | null> {
  const cacheKey = `rbac:${userId}:${workspaceId}`;

  try {
    const cached = await getCacheClient().get(cacheKey);
    if (cached === NULL_SENTINEL) return null;
    if (cached) return cached as MemberRole;
  } catch {
    // Redis failure — fall through to DB
  }

  return sf.do(cacheKey, async () => {
    const membership = await workspaceRepo.findMember(userId, workspaceId);
    const role       = membership?.role ?? null;
    try {
      const ttl = role ? CACHE_TTL_SECONDS : NEGATIVE_CACHE_TTL_SEC;
      await getCacheClient().setex(cacheKey, ttl, role ?? NULL_SENTINEL);
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
