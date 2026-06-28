import { getPool } from '@pulseway/db';
import { logger } from './logger.js';

const GROUP_WINDOW_SECONDS = 60;
const GROUP_THRESHOLD      = 3;

export class IncidentGrouper {
  /**
   * Groups concurrent incidents opened within GROUP_WINDOW_SECONDS for the same workspace.
   *
   * Uses pg_advisory_xact_lock scoped to the workspace to prevent race conditions
   * where two workers both detect the threshold and both create separate groups.
   * The lock is held only for the duration of the transaction.
   */
  async maybeGroup(workspaceId: string, newIncidentId: string): Promise<string | null> {
    const pool   = getPool();
    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      // Workspace-scoped advisory lock — converts the UUID to a bigint via MD5
      await client.query(
        `SELECT pg_advisory_xact_lock(('x' || substr(md5($1), 1, 16))::bit(64)::bigint)`,
        [workspaceId + ':group'],
      );

      const { rows: recent } = await client.query<{ id: string; group_id: string | null }>(
        `SELECT i.id, i.group_id
         FROM incidents i
         JOIN monitors m ON m.id = i.monitor_id
         WHERE m.workspace_id = $1
           AND i.started_at >= NOW() - ($2 || ' seconds')::INTERVAL
           AND i.status != 'resolved'`,
        [workspaceId, GROUP_WINDOW_SECONDS],
      );

      if (recent.length < GROUP_THRESHOLD) {
        await client.query('ROLLBACK');
        return null;
      }

      const existingGroupId = recent.find((r) => r.group_id !== null)?.group_id ?? null;

      if (existingGroupId) {
        await client.query(
          'UPDATE incidents SET group_id = $1 WHERE id = $2',
          [existingGroupId, newIncidentId],
        );
        await client.query('COMMIT');
        logger.info({ groupId: existingGroupId, incidentId: newIncidentId }, 'Incident attached to existing group');
        return existingGroupId;
      }

      const title = `${recent.length} monitors down — possible infrastructure issue`;
      const { rows: newGroup } = await client.query<{ id: string }>(
        'INSERT INTO incident_groups (workspace_id, title) VALUES ($1, $2) RETURNING id',
        [workspaceId, title],
      );
      const groupId = newGroup[0]?.id;
      if (!groupId) {
        await client.query('ROLLBACK');
        logger.error({ workspaceId }, 'IncidentGrouper: INSERT returned no id');
        return null;
      }

      // Attach all recent incidents (including the new one) to the group
      const allIncidentIds = [...new Set([...recent.map((r) => r.id), newIncidentId])];
      await client.query(
        'UPDATE incidents SET group_id = $1 WHERE id = ANY($2::uuid[])',
        [groupId, allIncidentIds],
      );

      await client.query('COMMIT');
      logger.warn({ groupId, incidentCount: allIncidentIds.length, workspaceId }, 'Incident group created — possible infrastructure outage');
      return groupId;
    } catch (err) {
      await client.query('ROLLBACK');
      logger.error({ err, workspaceId, incidentId: newIncidentId }, 'IncidentGrouper.maybeGroup failed');
      throw err;
    } finally {
      client.release();
    }
  }

  async resolveGroup(groupId: string): Promise<void> {
    const pool = getPool();

    const { rows } = await pool.query<{ count: string }>(
      `SELECT COUNT(*) AS count FROM incidents WHERE group_id = $1 AND status != 'resolved'`,
      [groupId],
    );

    const remaining = parseInt(rows[0]?.count ?? '0', 10);
    if (remaining === 0) {
      await pool.query(
        'UPDATE incident_groups SET resolved_at = NOW() WHERE id = $1 AND resolved_at IS NULL',
        [groupId],
      );
      logger.info({ groupId }, 'Incident group resolved');
    }
  }
}
