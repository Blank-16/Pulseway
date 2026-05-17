import { createHash, randomBytes } from 'node:crypto';
import { getPool } from '../client.js';

const TOKEN_EXPIRY_HOURS = 1;

export class PasswordResetRepository {
  private hash(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  async create(userId: string): Promise<string> {
    const token    = randomBytes(32).toString('hex');
    const hash     = this.hash(token);
    const expiresAt = new Date(Date.now() + TOKEN_EXPIRY_HOURS * 60 * 60 * 1000);
    const pool     = getPool();

    // Invalidate any prior unused tokens
    await pool.query(
      `UPDATE password_reset_tokens SET used_at = NOW()
       WHERE user_id = $1 AND used_at IS NULL`,
      [userId],
    );

    await pool.query(
      `INSERT INTO password_reset_tokens (user_id, token_hash, expires_at)
       VALUES ($1, $2, $3)`,
      [userId, hash, expiresAt],
    );

    return token;
  }

  async redeem(token: string): Promise<{ userId: string } | null> {
    const hash   = this.hash(token);
    const pool   = getPool();
    const client = await pool.connect();

    try {
      await client.query('BEGIN');
      const { rows } = await client.query<{ id: string; user_id: string }>(
        `UPDATE password_reset_tokens
         SET used_at = NOW()
         WHERE token_hash = $1 AND used_at IS NULL AND expires_at > NOW()
         RETURNING id, user_id`,
        [hash],
      );
      if (!rows[0]) { await client.query('ROLLBACK'); return null; }
      await client.query('COMMIT');
      return { userId: rows[0].user_id };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }
}
