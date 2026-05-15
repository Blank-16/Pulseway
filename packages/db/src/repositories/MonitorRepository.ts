import { getPool } from '../client.js';
import type { Monitor, CreateMonitorDTO } from '@pulseway/types';

interface MonitorRow {
  id: string;
  workspace_id: string;
  name: string;
  url: string;
  http_method: string;
  request_headers: Record<string, string>;
  expected_status_code: number;
  check_interval_seconds: number;
  region_codes: string[];
  is_active: boolean;
  last_checked_at: Date | null;
  created_at: Date;
}

function toMonitor(row: MonitorRow): Monitor {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    name: row.name,
    url: row.url,
    httpMethod: row.http_method as Monitor['httpMethod'],
    requestHeaders: row.request_headers,
    expectedStatusCode: row.expected_status_code,
    checkIntervalSeconds: row.check_interval_seconds as Monitor['checkIntervalSeconds'],
    regionCodes: row.region_codes,
    isActive: row.is_active,
    lastCheckedAt: row.last_checked_at?.toISOString() ?? null,
    createdAt: row.created_at.toISOString(),
  };
}

export class MonitorRepository {
  async insert(workspaceId: string, dto: CreateMonitorDTO): Promise<Monitor> {
    const pool = getPool();
    const { rows } = await pool.query<MonitorRow>(
      `INSERT INTO monitors
         (workspace_id, name, url, http_method, request_headers,
          expected_status_code, check_interval_seconds, region_codes)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [
        workspaceId,
        dto.name,
        dto.url,
        dto.httpMethod,
        JSON.stringify(dto.requestHeaders),
        dto.expectedStatusCode,
        dto.checkIntervalSeconds,
        dto.regionCodes,
      ],
    );
    const row = rows[0];
    if (!row) throw new Error('Insert returned no rows');
    return toMonitor(row);
  }

  async findById(id: string): Promise<Monitor | null> {
    const pool = getPool();
    const { rows } = await pool.query<MonitorRow>('SELECT * FROM monitors WHERE id = $1', [id]);
    return rows[0] ? toMonitor(rows[0]) : null;
  }


  async findByIdAndWorkspace(id: string, workspaceId: string): Promise<Monitor | null> {
    const pool = getPool();
    const { rows } = await pool.query<MonitorRow>(
      'SELECT * FROM monitors WHERE id = $1 AND workspace_id = $2 AND deleted_at IS NULL',
      [id, workspaceId],
    );
    return rows[0] ? toMonitor(rows[0]) : null;
  }


  async findByWorkspace(workspaceId: string): Promise<Monitor[]> {
    const pool = getPool();
    const { rows } = await pool.query<MonitorRow>(
      'SELECT * FROM monitors WHERE workspace_id = $1 ORDER BY created_at',
      [workspaceId],
    );
    return rows.map(toMonitor);
  }

  async update(id: string, patch: Partial<CreateMonitorDTO> & { isActive?: boolean }): Promise<Monitor | null> {
    const pool = getPool();
    const setClauses: string[] = [];
    const values: unknown[] = [];
    let idx = 1;

    // Explicit allowlist — column names never come from user input
    const scalarMap = new Map<string, string>([
      ['name', 'name'],
      ['url', 'url'],
      ['httpMethod', 'http_method'],
      ['expectedStatusCode', 'expected_status_code'],
      ['checkIntervalSeconds', 'check_interval_seconds'],
      ['isActive', 'is_active'],
    ]);

    for (const [field, col] of scalarMap) {
      const val = (patch as Record<string, unknown>)[field];
      if (val !== undefined) {
        setClauses.push(`${col} = $${idx++}`);
        values.push(val);
      }
    }

    if (patch.requestHeaders !== undefined) {
      setClauses.push(`request_headers = $${idx++}`);
      values.push(JSON.stringify(patch.requestHeaders));
    }

    if (patch.regionCodes !== undefined) {
      setClauses.push(`region_codes = $${idx++}`);
      values.push(patch.regionCodes);
    }

    if (setClauses.length === 0) return this.findById(id);

    values.push(id);
    const { rows } = await pool.query<MonitorRow>(
      `UPDATE monitors SET ${setClauses.join(', ')} WHERE id = $${idx} RETURNING *`,
      values,
    );
    return rows[0] ? toMonitor(rows[0]) : null;
  }

  async delete(id: string): Promise<void> {
    const pool = getPool();
    await pool.query('DELETE FROM monitors WHERE id = $1', [id]);
  }

  // Returns monitors whose next check is overdue
  async findDue(): Promise<Monitor[]> {
    const pool = getPool();
    const { rows } = await pool.query<MonitorRow>(
      `SELECT * FROM monitors
       WHERE is_active = true
         AND (last_checked_at IS NULL
              OR last_checked_at < NOW() - (check_interval_seconds * INTERVAL '1 second'))
       ORDER BY last_checked_at NULLS FIRST`,
    );
    return rows.map(toMonitor);
  }

  async updateLastCheckedAt(ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    const pool = getPool();
    await pool.query(
      `UPDATE monitors SET last_checked_at = NOW()
       WHERE id = ANY($1::uuid[])`,
      [ids],
    );
  }

  async countByWorkspace(workspaceId: string): Promise<number> {
    const pool = getPool();
    const { rows } = await pool.query<{ count: string }>(
      'SELECT COUNT(*) AS count FROM monitors WHERE workspace_id = $1',
      [workspaceId],
    );
    return parseInt(rows[0]?.count ?? '0', 10);
  }
}
