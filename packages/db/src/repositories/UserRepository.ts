import { getPool } from '../client.js';
import type { User } from '@pulseway/types';

interface UserRow {
  id: string;
  email: string;
  password_hash: string;
  name: string;
  email_verified: boolean;
  created_at: Date;
}

interface InsertUserParams {
  email: string;
  passwordHash: string;
  name: string;
}

function toUser(row: UserRow): User {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    emailVerified: row.email_verified,
    createdAt: row.created_at.toISOString(),
  };
}

export class UserRepository {
  async insert(params: InsertUserParams): Promise<User> {
    const pool = getPool();
    const { rows } = await pool.query<UserRow>(
      `INSERT INTO users (email, password_hash, name)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [params.email, params.passwordHash, params.name],
    );
    const row = rows[0];
    if (!row) throw new Error('Insert returned no rows');
    return toUser(row);
  }

  async findById(id: string): Promise<User | null> {
    const pool = getPool();
    const { rows } = await pool.query<UserRow>('SELECT * FROM users WHERE id = $1', [id]);
    return rows[0] ? toUser(rows[0]) : null;
  }

  async findByEmail(email: string): Promise<(User & { passwordHash: string }) | null> {
    const pool = getPool();
    const { rows } = await pool.query<UserRow>('SELECT * FROM users WHERE email = $1', [email]);
    if (!rows[0]) return null;
    return { ...toUser(rows[0]), passwordHash: rows[0].password_hash };
  }

  async markEmailVerified(id: string): Promise<void> {
    const pool = getPool();
    await pool.query('UPDATE users SET email_verified = true WHERE id = $1', [id]);
  }
}
