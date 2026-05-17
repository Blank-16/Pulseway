import { getPool } from '../client.js';
import { createHash, randomBytes } from 'node:crypto';

interface RefreshTokenRow {
  id          : string;
  user_id     : string;
  token_hash  : string;
  expires_at  : Date;
  revoked     : boolean;
  replaced_by : string | null;
  session_id  : string;
  device_name : string | null;
  created_at  : Date;
}

export class RefreshTokenRepository {
  private hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  async create(userId: string, expiryDays: number, sessionId?: string, deviceName?: string): Promise<string> {
    const token     = randomBytes(48).toString('hex');
    const hash      = this.hashToken(token);
    const expiresAt = new Date(Date.now() + expiryDays * 24 * 60 * 60 * 1000);
    const pool      = getPool();
    await pool.query(
      `INSERT INTO refresh_tokens (user_id, token_hash, expires_at, session_id, device_name)
       VALUES ($1, $2, $3, $4, $5)`,
      [userId, hash, expiresAt, sessionId ?? crypto.randomUUID(), deviceName ?? null],
    );
    return token;
  }

  /**
   * Rotates the refresh token: marks the presented token as revoked + replaced,
   * inserts a fresh token, and returns it.
   *
   * If the presented token is already revoked (replay attack), returns null AND
   * revokes the entire replacement chain to invalidate a stolen session.
   */
  async rotate(token: string, expiryDays: number): Promise<string | null> {
    const hash   = this.hashToken(token);
    const pool   = getPool();
    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      const { rows } = await client.query<RefreshTokenRow>(
        `SELECT * FROM refresh_tokens WHERE token_hash = $1`,
        [hash],
      );
      const existing = rows[0];

      if (!existing) {
        await client.query('ROLLBACK');
        return null;
      }

      // Replay attack: token already revoked — invalidate the whole chain
      if (existing.revoked) {
        await this.revokeChain(client, existing.id);
        await client.query('COMMIT');
        return null;
      }

      if (existing.expires_at < new Date()) {
        await client.query('ROLLBACK');
        return null;
      }

      // Issue new token
      const newToken     = randomBytes(48).toString('hex');
      const newHash      = this.hashToken(newToken);
      const newExpiresAt = new Date(Date.now() + expiryDays * 24 * 60 * 60 * 1000);

      const { rows: newRows } = await client.query<{ id: string }>(
        `INSERT INTO refresh_tokens (user_id, token_hash, expires_at)
         VALUES ($1, $2, $3) RETURNING id`,
        [existing.user_id, newHash, newExpiresAt],
      );
      const newId = newRows[0]!.id;

      // Mark old token replaced
      await client.query(
        `UPDATE refresh_tokens
         SET revoked = true, replaced_by = $1
         WHERE id = $2`,
        [newId, existing.id],
      );

      await client.query('COMMIT');
      return newToken;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  async findValid(token: string): Promise<{ userId: string } | null> {
    const hash = this.hashToken(token);
    const pool = getPool();
    const { rows } = await pool.query<RefreshTokenRow>(
      `SELECT * FROM refresh_tokens
       WHERE token_hash = $1 AND revoked = false AND expires_at > NOW()`,
      [hash],
    );
    return rows[0] ? { userId: rows[0].user_id } : null;
  }

  async revoke(token: string): Promise<void> {
    const hash = this.hashToken(token);
    const pool = getPool();
    await pool.query(
      'UPDATE refresh_tokens SET revoked = true WHERE token_hash = $1',
      [hash],
    );
  }

  async revokeAllForUser(userId: string): Promise<void> {
    const pool = getPool();
    await pool.query(
      `UPDATE refresh_tokens
       SET revoked = true
       WHERE user_id = $1 AND revoked = false AND expires_at > NOW()`,
      [userId],
    );
  }

  // Revokes the token with the given ID and all tokens in its replacement chain
  private async revokeChain(
    client: Awaited<ReturnType<ReturnType<typeof getPool>['connect']>>,
    rootId: string,
  ): Promise<void> {
    // Revoke all tokens in the same session — per-device isolation
    // prevents a stolen token on one device from invalidating other sessions
    await client.query(
      `UPDATE refresh_tokens
       SET revoked = true
       WHERE session_id = (SELECT session_id FROM refresh_tokens WHERE id = $1)`,
      [rootId],
    );
  }
}
