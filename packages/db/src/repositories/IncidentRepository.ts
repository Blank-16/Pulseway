import { getPool } from '../client.js';
import type { Incident, IncidentTimelineEvent } from '@pulseway/types';

interface IncidentRow {
  id: string;
  monitor_id: string;
  status: string;
  started_at: Date;
  acknowledged_at: Date | null;
  acknowledged_by: string | null;
  resolved_at: Date | null;
  duration_seconds: number | null;
  group_id: string | null;
}

interface TimelineRow {
  id: string;
  incident_id: string;
  event_type: string;
  message: string;
  created_by: string | null;
  created_at: Date;
}

function toIncident(row: IncidentRow): Incident {
  return {
    id             : row.id,
    monitorId      : row.monitor_id,
    status         : row.status as Incident['status'],
    startedAt      : row.started_at.toISOString(),
    acknowledgedAt : row.acknowledged_at?.toISOString() ?? null,
    acknowledgedBy : row.acknowledged_by,
    resolvedAt     : row.resolved_at?.toISOString() ?? null,
    durationSeconds: row.duration_seconds,
    groupId: row.group_id ?? null,
  };
}

function toTimeline(row: TimelineRow): IncidentTimelineEvent {
  return {
    id        : row.id,
    incidentId: row.incident_id,
    eventType : row.event_type as IncidentTimelineEvent['eventType'],
    message   : row.message,
    createdBy : row.created_by,
    createdAt : row.created_at.toISOString(),
  };
}

export class IncidentRepository {
  async insert(monitorId: string): Promise<Incident> {
    const pool   = getPool();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // pg_advisory_xact_lock prevents two workers racing to open the same incident
      await client.query(
        `SELECT pg_advisory_xact_lock(('x' || substr(md5($1), 1, 16))::bit(64)::bigint)`,
        [monitorId],
      );

      const existing = await client.query<IncidentRow>(
        `SELECT * FROM incidents WHERE monitor_id = $1 AND status IN ('open', 'acknowledged') LIMIT 1`,
        [monitorId],
      );
      if (existing.rows[0]) {
        await client.query('COMMIT');
        return toIncident(existing.rows[0]);
      }

      const { rows } = await client.query<IncidentRow>(
        `INSERT INTO incidents (monitor_id) VALUES ($1) RETURNING *`,
        [monitorId],
      );
      await client.query('COMMIT');

      const row = rows[0];
      if (!row) throw new Error('Insert returned no rows');
      return toIncident(row);
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  async findById(id: string): Promise<Incident | null> {
    const pool = getPool();
    const { rows } = await pool.query<IncidentRow>('SELECT * FROM incidents WHERE id = $1', [id]);
    return rows[0] ? toIncident(rows[0]) : null;
  }

  async findByIdAndWorkspace(id: string, workspaceId: string): Promise<Incident | null> {
    const pool = getPool();
    const { rows } = await pool.query<IncidentRow>(
      `SELECT i.* FROM incidents i
       JOIN monitors m ON m.id = i.monitor_id
       WHERE i.id = $1 AND m.workspace_id = $2`,
      [id, workspaceId],
    );
    return rows[0] ? toIncident(rows[0]) : null;
  }

  async findOpenByMonitorId(monitorId: string): Promise<Incident | null> {
    const pool = getPool();
    const { rows } = await pool.query<IncidentRow>(
      `SELECT * FROM incidents WHERE monitor_id = $1 AND status != 'resolved' ORDER BY started_at DESC LIMIT 1`,
      [monitorId],
    );
    return rows[0] ? toIncident(rows[0]) : null;
  }

  /**
   * Keyset pagination on (started_at DESC, id DESC) — O(log N) on the index,
   * not O(page*pageSize) like OFFSET.
   * cursor: base64-encoded JSON { startedAt: ISO string, id: string } of the last seen row.
   */

  async findOpenByMonitorIds(monitorIds: string[]): Promise<Map<string, Incident>> {
    if (monitorIds.length === 0) return new Map();
    const pool = getPool();
    const { rows } = await pool.query<IncidentRow>(
      `SELECT DISTINCT ON (monitor_id) *
       FROM incidents
       WHERE monitor_id = ANY($1::uuid[])
         AND status != 'resolved'
       ORDER BY monitor_id, started_at DESC`,
      [monitorIds],
    );
    return new Map(rows.map((r) => [r.monitor_id, toIncident(r)]));
  }


  async findByWorkspace(
    workspaceId: string,
    pageSize: number,
    cursor?: string,
  ): Promise<{ incidents: Incident[]; nextCursor: string | null; total: number }> {
    const pool = getPool();

    const [dataRes, countRes] = await Promise.all([
      cursor
        ? (() => {
            let startedAt: string;
            let id       : string;
            try {
              const decoded = JSON.parse(Buffer.from(cursor, 'base64url').toString()) as { startedAt: string; id: string };
              startedAt = decoded.startedAt;
              id        = decoded.id;
              if (!startedAt || !id) throw new Error('missing fields');
            } catch {
              throw Object.assign(new Error('Invalid cursor format'), { statusCode: 400 });
            }
            return pool.query<IncidentRow>(
              `SELECT i.* FROM incidents i
               JOIN monitors m ON m.id = i.monitor_id
               WHERE m.workspace_id = $1
                 AND (i.started_at, i.id) < ($2::timestamptz, $3::uuid)
               ORDER BY i.started_at DESC, i.id DESC
               LIMIT $4`,
              [workspaceId, startedAt, id, pageSize],
            );
          })()
        : pool.query<IncidentRow>(
            `SELECT i.* FROM incidents i
             JOIN monitors m ON m.id = i.monitor_id
             WHERE m.workspace_id = $1
             ORDER BY i.started_at DESC, i.id DESC
             LIMIT $2`,
            [workspaceId, pageSize],
          ),
      pool.query<{ count: string }>(
        `SELECT COUNT(*) AS count FROM incidents i
         JOIN monitors m ON m.id = i.monitor_id
         WHERE m.workspace_id = $1`,
        [workspaceId],
      ),
    ]);

    const incidents  = dataRes.rows.map(toIncident);
    const last       = incidents[incidents.length - 1];
    const nextCursor = incidents.length === pageSize && last
      ? Buffer.from(JSON.stringify({ startedAt: last.startedAt, id: last.id })).toString('base64url')
      : null;

    return {
      incidents,
      nextCursor,
      total: parseInt(countRes.rows[0]?.count ?? '0', 10),
    };
  }

  async acknowledge(id: string, userId: string): Promise<Incident | null> {
    const pool = getPool();
    const { rows } = await pool.query<IncidentRow>(
      `UPDATE incidents
       SET status = 'acknowledged', acknowledged_at = NOW(), acknowledged_by = $2
       WHERE id = $1
       RETURNING *`,
      [id, userId],
    );
    return rows[0] ? toIncident(rows[0]) : null;
  }

  async resolve(id: string): Promise<Incident | null> {
    const pool = getPool();
    const { rows } = await pool.query<IncidentRow>(
      `UPDATE incidents
       SET status = 'resolved', resolved_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [id],
    );
    return rows[0] ? toIncident(rows[0]) : null;
  }

  async appendTimeline(
    incidentId: string,
    eventType: IncidentTimelineEvent['eventType'],
    message: string,
    createdBy: string | null,
  ): Promise<IncidentTimelineEvent> {
    const pool = getPool();
    const { rows } = await pool.query<TimelineRow>(
      `INSERT INTO incident_timeline (incident_id, event_type, message, created_by)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [incidentId, eventType, message, createdBy],
    );
    const row = rows[0];
    if (!row) throw new Error('Insert returned no rows');
    return toTimeline(row);
  }

  async getTimeline(incidentId: string): Promise<IncidentTimelineEvent[]> {
    const pool = getPool();
    const { rows } = await pool.query<TimelineRow>(
      'SELECT * FROM incident_timeline WHERE incident_id = $1 ORDER BY created_at',
      [incidentId],
    );
    return rows.map(toTimeline);
  }
}
