/**
 * Integration test — requires Docker Compose services to be running.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { getTestPool, runMigrations, truncateTables, teardown } from './setup.js';

vi.mock('../../packages/db/src/client.js', async () => {
  const { getTestPool } = await import('./setup.js');
  return { getPool: getTestPool };
});

import { EmailVerificationRepository } from '../../packages/db/src/repositories/EmailVerificationRepository.js';

describe('EmailVerificationRepository (integration)', () => {
  const repo = new EmailVerificationRepository();
  let userId: string;

  beforeAll(async () => {
    await runMigrations();
    const pool = await getTestPool();
    const { rows: [u] } = await pool.query<{ id: string }>(
      `INSERT INTO users (email, password_hash, name) VALUES ('verify@test.com', 'hash', 'Verify') RETURNING id`,
    );
    userId = u!.id;
  });

  beforeEach(() => truncateTables());
  afterAll(() => teardown());

  it('creates a token and redeems it, setting email_verified', async () => {
    const token  = await repo.create(userId);
    const result = await repo.redeem(token);

    expect(result?.userId).toBe(userId);

    const pool = await getTestPool();
    const { rows: [u] } = await pool.query<{ email_verified: boolean }>(
      'SELECT email_verified FROM users WHERE id = $1', [userId],
    );
    expect(u!.email_verified).toBe(true);
  });

  it('token can only be redeemed once (single-use)', async () => {
    const token  = await repo.create(userId);
    await repo.redeem(token);
    const second = await repo.redeem(token);
    expect(second).toBeNull();
  });

  it('returns null for unknown token', async () => {
    const result = await repo.redeem('totally-invalid-token');
    expect(result).toBeNull();
  });

  it('returns null for expired token', async () => {
    const pool  = await getTestPool();
    const token = await repo.create(userId);
    await pool.query(
      `UPDATE email_verification_tokens SET expires_at = NOW() - INTERVAL '1 second' WHERE user_id = $1`,
      [userId],
    );
    const result = await repo.redeem(token);
    expect(result).toBeNull();
  });

  it('invalidates previous tokens when a new one is created', async () => {
    const first  = await repo.create(userId);
    await repo.create(userId); // second create invalidates first
    const result = await repo.redeem(first);
    expect(result).toBeNull();
  });
});
