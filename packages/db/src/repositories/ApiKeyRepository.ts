import { createHash, randomBytes } from 'node:crypto';
import { getPool } from '../client.js';
import type { MemberRole } from '@pulseway/types';

export interface ApiKey {
  id          : string;
  workspaceId : string;
  name        : string;
  keyPrefix   : string;
  role        : MemberRole;
  lastUsedAt  : string | null;
  expiresAt   : string | null;
  revoked     : boolean;
  createdBy   : string;
  createdAt   : string;
}

interface ApiKeyRow {
  id: string; workspace_id: string; name: string; key_hash: string;
  key_prefix: string; role: string; last_used_at: Date | null;
  expires_at: Date | null; revoked: boolean; created_by: string; created_at: Date;
}

function toApiKey(row: ApiKeyRow): ApiKey {
  return {
    id         : row.id,
    workspaceId: row.workspace_id,
    name       : row.name,
    keyPrefix  : row.key_prefix,
    role       : row.role as MemberRole,
    lastUsedAt : row.last_used_at?.toISOString() ?? null,
    expiresAt  : row.expires_at?.toISOString() ?? null,
    revoked    : row.revoked,
    createdBy  : row.created_by,
    createdAt  : row.created_at.toISOString(),
  };
}

export class ApiKeyRepository {
  private hash(raw: string): string {
    return createHash('sha256').update(raw).digest('hex');
  }

  async create(
    workspaceId: string,
    name: string,
    role: MemberRole,
    createdBy: string,
    expiresAt?: Date,
  ): Promise<{ apiKey: ApiKey; rawKey: string }> {
    const raw    = `pw_${randomBytes(32).toString('hex')}`;
    const hash   = this.hash(raw);
    const prefix = raw.slice(0, 10);
    const pool   = getPool();

    const { rows } = await pool.query<ApiKeyRow>(
      `INSERT INTO api_keys (workspace_id, name, key_hash, key_prefix, role, created_by, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [workspaceId, name, hash, prefix, role, createdBy, expiresAt ?? null],
    );
    const row = rows[0]!;
    return { apiKey: toApiKey(row), rawKey: raw };
  }

  async findByHash(raw: string): Promise<(ApiKey & { workspaceId: string }) | null> {
    const hash = this.hash(raw);
    const pool = getPool();
    const { rows } = await pool.query<ApiKeyRow>(
      `SELECT * FROM api_keys
       WHERE key_hash = $1
         AND revoked = false
         AND (expires_at IS NULL OR expires_at > NOW())`,
      [hash],
    );
    if (!rows[0]) return null;
    // Update last_used_at async — fire-and-forget, non-critical
    pool.query('UPDATE api_keys SET last_used_at = NOW() WHERE id = $1', [rows[0].id]).catch(() => null);
    return toApiKey(rows[0]);
  }

  async listByWorkspace(workspaceId: string): Promise<ApiKey[]> {
    const pool = getPool();
    const { rows } = await pool.query<ApiKeyRow>(
      `SELECT * FROM api_keys WHERE workspace_id = $1 ORDER BY created_at DESC`,
      [workspaceId],
    );
    return rows.map(toApiKey);
  }

  async revoke(id: string, workspaceId: string): Promise<boolean> {
    const pool = getPool();
    const { rowCount } = await pool.query(
      `UPDATE api_keys SET revoked = true WHERE id = $1 AND workspace_id = $2`,
      [id, workspaceId],
    );
    return (rowCount ?? 0) > 0;
  }
}
