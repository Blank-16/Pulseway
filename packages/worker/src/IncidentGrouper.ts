import { getPool } from '@pulseway/db';

const GROUP_WINDOW_SECONDS = 60;
const GROUP_THRESHOLD      = 3; // open N+ incidents in window → create group

export class IncidentGrouper {
  /**
   * Called after a new incident is inserted.
   * If N+ incidents were opened for the same workspace within GROUP_WINDOW_SECONDS,
   * group them under one root-cause entry and emit a single aggregated alert.
   * Returns the group ID if a group was created or found, null otherwise.
   */
  async maybeGroup(workspaceId: string, newIncidentId: string): Promise<string | null> {
    const pool = getPool();

    // Find all incidents opened in the last GROUP_WINDOW_SECONDS for this workspace
    const { rows: recent } = await pool.query<{ id: string; group_id: string | null }>(
      `SELECT i.id, i.group_id
       FROM incidents i
       JOIN monitors m ON m.id = i.monitor_id
       WHERE m.workspace_id = $1
         AND i.started_at >= NOW() - ($2 || ' seconds')::INTERVAL
         AND i.status != 'resolved'`,
      [workspaceId, GROUP_WINDOW_SECONDS],
    );

    if (recent.length < GROUP_THRESHOLD) return null;

    // Check if a group already exists for this window
    const existingGroupId = recent.find((r) => r.group_id !== null)?.group_id ?? null;

    if (existingGroupId) {
      // Attach the new incident to the existing group
      await pool.query(
        `UPDATE incidents SET group_id = $1 WHERE id = $2`,
        [existingGroupId, newIncidentId],
      );
      return existingGroupId;
    }

    // Create a new group and attach all recent incidents
    const title = `${recent.length} monitors down — possible infrastructure issue`;
    const { rows: newGroup } = await pool.query<{ id: string }>(
      `INSERT INTO incident_groups (workspace_id, title) VALUES ($1, $2) RETURNING id`,
      [workspaceId, title],
    );
    const groupId = newGroup[0]!.id;

    await pool.query(
      `UPDATE incidents SET group_id = $1 WHERE id = ANY($2::uuid[])`,
      [groupId, recent.map((r) => r.id)],
    );

    return groupId;
  }

  async resolveGroup(groupId: string): Promise<void> {
    const pool = getPool();
    // Resolve group only when all member incidents are resolved
    const { rows } = await pool.query<{ count: string }>(
      `SELECT COUNT(*) AS count FROM incidents WHERE group_id = $1 AND status != 'resolved'`,
      [groupId],
    );
    const remaining = parseInt(rows[0]?.count ?? '0', 10);
    if (remaining === 0) {
      await pool.query(
        `UPDATE incident_groups SET resolved_at = NOW() WHERE id = $1`,
        [groupId],
      );
    }
  }
}
