import { getPool } from '@pulseway/db';
import { getCacheClient } from '../redis.js';

const CACHE_TTL_SECONDS = 30;
const CACHE_PREFIX      = 'ff:';

interface FlagRow {
  enabled    : boolean;
  rollout_pct: number;
}

export class FeatureFlagService {
  /**
   * Returns true if the flag is enabled for the given workspace.
   * Resolution order:
   *   1. Workspace-specific override (if exists)
   *   2. Global flag default
   *   3. false (flag not found)
   *
   * Rollout percentage: checked against a deterministic hash of (flagName + workspaceId)
   * so the same workspace always gets the same answer for a given rollout_pct.
   */
  async isEnabled(flagName: string, workspaceId?: string): Promise<boolean> {
    const cacheKey = `${CACHE_PREFIX}${flagName}:${workspaceId ?? 'global'}`;

    try {
      const cached = await getCacheClient().get(cacheKey);
      if (cached !== null) return cached === '1';
    } catch {
      // Cache miss — fall through to DB
    }

    const pool   = getPool();
    const { rows } = await pool.query<FlagRow>(
      `SELECT enabled, rollout_pct FROM feature_flags
       WHERE flag_name = $1
         AND (workspace_id = $2 OR workspace_id IS NULL)
       ORDER BY workspace_id NULLS LAST
       LIMIT 1`,
      [flagName, workspaceId ?? null],
    );

    const flag   = rows[0];
    let enabled  = flag?.enabled ?? false;

    if (enabled && flag && flag.rollout_pct < 100 && workspaceId) {
      // Deterministic rollout: hash workspace into 0-99 range
      const hash  = workspaceId.split('').reduce((acc, c) => ((acc << 5) - acc + c.charCodeAt(0)) | 0, 0);
      const bucket = Math.abs(hash) % 100;
      enabled     = bucket < flag.rollout_pct;
    }

    try {
      await getCacheClient().setex(cacheKey, CACHE_TTL_SECONDS, enabled ? '1' : '0');
    } catch {
      // Non-fatal
    }

    return enabled;
  }

  async setFlag(flagName: string, enabled: boolean, workspaceId?: string, rolloutPct = 100): Promise<void> {
    const pool = getPool();
    await pool.query(
      `INSERT INTO feature_flags (flag_name, workspace_id, enabled, rollout_pct)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (flag_name, workspace_id) DO UPDATE
         SET enabled = $3, rollout_pct = $4, updated_at = NOW()`,
      [flagName, workspaceId ?? null, enabled, rolloutPct],
    );
    // Invalidate cache
    try {
      await getCacheClient().del(`${CACHE_PREFIX}${flagName}:${workspaceId ?? 'global'}`);
    } catch {
      // Non-fatal
    }
  }

  async listFlags(workspaceId?: string): Promise<Array<{ name: string; enabled: boolean; rolloutPct: number; scope: 'workspace' | 'global' }>> {
    const pool = getPool();
    const { rows } = await pool.query<{ flag_name: string; enabled: boolean; rollout_pct: number; workspace_id: string | null }>(
      `SELECT DISTINCT ON (flag_name) flag_name, enabled, rollout_pct, workspace_id
       FROM feature_flags
       WHERE workspace_id = $1 OR workspace_id IS NULL
       ORDER BY flag_name, workspace_id NULLS LAST`,
      [workspaceId ?? null],
    );
    return rows.map((r) => ({
      name      : r.flag_name,
      enabled   : r.enabled,
      rolloutPct: r.rollout_pct,
      scope     : r.workspace_id ? 'workspace' : 'global',
    }));
  }
}

export const featureFlags = new FeatureFlagService();
