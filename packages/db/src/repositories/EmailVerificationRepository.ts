import { createHash, randomBytes } from 'node:crypto';
import { getPool } from '../client.js';

const TOKEN_EXPIRY_HOURS = 24;

export interface VerificationResult {
  userId   : string;
  tokenId  : string;
}

export class EmailVerificationRepository {
  private hash(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  async create(userId: string): Promise<string> {
    const token    = randomBytes(32).toString('hex');
    const hash     = this.hash(token);
    const expiresAt = new Date(Date.now() + TOKEN_EXPIRY_HOURS * 60 * 60 * 1000);
    const pool     = getPool();

    // Invalidate any prior unused tokens for this user before issuing a new one
    await pool.query(
      `UPDATE email_verification_tokens
       SET used_at = NOW()
       WHERE user_id = $1 AND used_at IS NULL`,
      [userId],
    );

    await pool.query(
      `INSERT INTO email_verification_tokens (user_id, token_hash, expires_at)
       VALUES ($1, $2, $3)`,
      [userId, hash, expiresAt],
    );

    return token;
  }

  async redeem(token: string): Promise<VerificationResult | null> {
    const hash = this.hash(token);
    const pool = getPool();
    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      // Atomic claim — only succeeds once; concurrent redemptions are serialized
      const { rows } = await client.query<{ id: string; user_id: string }>(
        `UPDATE email_verification_tokens
         SET used_at = NOW()
         WHERE token_hash = $1
           AND used_at IS NULL
           AND expires_at > NOW()
         RETURNING id, user_id`,
        [hash],
      );

      if (!rows[0]) {
        await client.query('ROLLBACK');
        return null;
      }

      await client.query(
        'UPDATE users SET email_verified = true WHERE id = $1',
        [rows[0].user_id],
      );

      await client.query('COMMIT');
      return { userId: rows[0].user_id, tokenId: rows[0].id };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  async findPendingForUser(userId: string): Promise<boolean> {
    const pool = getPool();
    const { rows } = await pool.query<{ id: string }>(
      `SELECT id FROM email_verification_tokens
       WHERE user_id = $1 AND used_at IS NULL AND expires_at > NOW()
       LIMIT 1`,
      [userId],
    );
    return rows.length > 0;
  }
}
