/**
 * Integration test — requires Docker Compose services to be running.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { getTestPool, runMigrations, truncateTables, teardown } from './setup.js';

vi.mock('../../packages/db/src/client.js', async () => {
  const { getTestPool } = await import('./setup.js');
  return { getPool: getTestPool };
});

import { RefreshTokenRepository } from '../../packages/db/src/repositories/RefreshTokenRepository.js';

describe('RefreshTokenRepository rotation (integration)', () => {
  const repo = new RefreshTokenRepository();
  let userId : string;

  beforeAll(async () => {
    await runMigrations();
    const pool = await getTestPool();
    const { rows: [u] } = await pool.query<{ id: string }>(
      `INSERT INTO users (email, password_hash, name) VALUES ('rotate@test.com', 'hash', 'Rotate') RETURNING id`,
    );
    userId = u!.id;
  });

  beforeEach(() => truncateTables());
  afterAll(() => teardown());

  it('rotate returns a new token and revokes the old one', async () => {
    const original = await repo.create(userId, 30);
    const rotated  = await repo.rotate(original, 30);

    expect(rotated).not.toBeNull();
    expect(rotated).not.toBe(original);

    // Old token should now be invalid
    const old = await repo.findValid(original);
    expect(old).toBeNull();

    // New token should be valid
    const fresh = await repo.findValid(rotated!);
    expect(fresh?.userId).toBe(userId);
  });

  it('rotate returns null and revokes chain on replay (stolen token reuse)', async () => {
    const original = await repo.create(userId, 30);
    // First rotation — legitimate
    const rotated = await repo.rotate(original, 30);
    expect(rotated).not.toBeNull();

    // Replay the original (attacker) — should revoke the chain
    const replayed = await repo.rotate(original, 30);
    expect(replayed).toBeNull();

    // The rotated token should now also be revoked (chain revocation)
    const stolen = await repo.findValid(rotated!);
    expect(stolen).toBeNull();
  });

  it('rotate returns null for expired token', async () => {
    const pool  = await getTestPool();
    const token = await repo.create(userId, 30);
    // Manually expire it
    await pool.query(
      `UPDATE refresh_tokens SET expires_at = NOW() - INTERVAL '1 second' WHERE user_id = $1`,
      [userId],
    );
    const result = await repo.rotate(token, 30);
    expect(result).toBeNull();
  });

  it('rotate returns null for unknown token', async () => {
    const result = await repo.rotate('nonexistent-token', 30);
    expect(result).toBeNull();
  });
});
