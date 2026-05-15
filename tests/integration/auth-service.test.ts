import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockQuery       = vi.fn();
const mockPoolConnect = vi.fn();

vi.mock('@pulseway/db', () => ({
  UserRepository: vi.fn().mockImplementation(() => ({
    findByEmail: vi.fn(),
    findById   : vi.fn(),
  })),
  WorkspaceRepository: vi.fn().mockImplementation(() => ({
    findUserWorkspaces: vi.fn(),
    findMember        : vi.fn(),
  })),
  RefreshTokenRepository: vi.fn().mockImplementation(() => ({
    create   : vi.fn().mockResolvedValue('token-abc'),
    findValid: vi.fn(),
    revoke   : vi.fn().mockResolvedValue(undefined),
    rotate   : vi.fn(),
  })),
  getPool: () => ({ connect: mockPoolConnect, query: mockQuery }),
}));

vi.mock('@pulseway/config', () => ({
  getConfig: vi.fn().mockReturnValue({
    JWT_SECRET: 'supersecretjwtkeywithenoughchars!!',
    NODE_ENV  : 'test',
  }),
}));

vi.mock('bcryptjs', async () => {
  const actual = await vi.importActual<typeof import('bcryptjs')>('bcryptjs');
  return { default: { ...actual, hash: vi.fn().mockResolvedValue('$2b$12$hashed'), compare: vi.fn() } };
});

vi.mock('../../packages/api/src/services/EmailVerificationService.js', () => ({
  EmailVerificationService: vi.fn().mockImplementation(() => ({
    sendVerificationEmail: vi.fn().mockResolvedValue(undefined),
    verify               : vi.fn().mockResolvedValue({ userId: 'u1' }),
    resend               : vi.fn().mockResolvedValue(undefined),
  })),
}));

import { AuthService } from '../../packages/api/src/services/AuthService.js';
import { UserRepository, WorkspaceRepository, RefreshTokenRepository } from '@pulseway/db';
import bcrypt from 'bcryptjs';

const verifiedUser = {
  id: 'u1', email: 'a@b.com', name: 'A', passwordHash: '$2b$12$hashed',
  emailVerified: true, createdAt: new Date().toISOString(),
};

const unverifiedUser = { ...verifiedUser, emailVerified: false };

describe('AuthService.login', () => {
  let authService  : AuthService;
  let userRepo     : ReturnType<typeof vi.fn>;
  let workspaceRepo: ReturnType<typeof vi.fn>;
  let refreshRepo  : ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    authService   = new AuthService();
    userRepo      = (UserRepository as ReturnType<typeof vi.fn>).mock.results.at(-1)?.value;
    workspaceRepo = (WorkspaceRepository as ReturnType<typeof vi.fn>).mock.results.at(-1)?.value;
    refreshRepo   = (RefreshTokenRepository as ReturnType<typeof vi.fn>).mock.results.at(-1)?.value;
  });

  it('runs bcrypt even for unknown email (timing oracle defence)', async () => {
    userRepo.findByEmail.mockResolvedValue(null);
    (bcrypt.compare as ReturnType<typeof vi.fn>).mockResolvedValue(false);

    await expect(authService.login('x@x.com', 'wrong')).rejects.toMatchObject({ statusCode: 401 });
    expect(bcrypt.compare).toHaveBeenCalled();
  });

  it('throws 401 for wrong password', async () => {
    userRepo.findByEmail.mockResolvedValue(verifiedUser);
    (bcrypt.compare as ReturnType<typeof vi.fn>).mockResolvedValue(false);

    await expect(authService.login('a@b.com', 'bad')).rejects.toMatchObject({ statusCode: 401 });
  });

  it('throws 403 when email is not verified', async () => {
    userRepo.findByEmail.mockResolvedValue(unverifiedUser);
    (bcrypt.compare as ReturnType<typeof vi.fn>).mockResolvedValue(true);

    await expect(authService.login('a@b.com', 'correct')).rejects.toMatchObject({
      statusCode: 403,
      message   : expect.stringContaining('not verified'),
    });
  });

  it('returns accessToken + refreshToken on valid credentials', async () => {
    userRepo.findByEmail.mockResolvedValue(verifiedUser);
    (bcrypt.compare as ReturnType<typeof vi.fn>).mockResolvedValue(true);
    workspaceRepo.findUserWorkspaces.mockResolvedValue([{ id: 'ws1', name: 'W', slug: 'w', plan: 'free' }]);
    workspaceRepo.findMember.mockResolvedValue({ role: 'owner' });

    const result = await authService.login('a@b.com', 'correct');
    expect(result.accessToken).toBeTruthy();
    expect(result.refreshToken).toBe('token-abc');
    expect(result.user.email).toBe('a@b.com');
  });
});

describe('AuthService.refresh', () => {
  let authService: AuthService;
  let refreshRepo: ReturnType<typeof vi.fn>;
  let userRepo   : ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    authService = new AuthService();
    refreshRepo = (RefreshTokenRepository as ReturnType<typeof vi.fn>).mock.results.at(-1)?.value;
    userRepo    = (UserRepository as ReturnType<typeof vi.fn>).mock.results.at(-1)?.value;
  });

  it('throws 401 when rotate returns null (invalid/replayed token)', async () => {
    refreshRepo.rotate.mockResolvedValue(null);
    await expect(authService.refresh('bad-token')).rejects.toMatchObject({ statusCode: 401 });
  });

  it('returns new accessToken and rotated refreshToken', async () => {
    refreshRepo.rotate.mockResolvedValue('new-raw-token');
    refreshRepo.findValid.mockResolvedValue({ userId: 'u1' });
    userRepo.findById.mockResolvedValue(verifiedUser);
    const workspaceRepo = (WorkspaceRepository as ReturnType<typeof vi.fn>).mock.results.at(-1)?.value;
    workspaceRepo.findUserWorkspaces.mockResolvedValue([{ id: 'ws1', name: 'W', slug: 'w', plan: 'free' }]);
    workspaceRepo.findMember.mockResolvedValue({ role: 'owner' });

    const result = await authService.refresh('old-token');
    expect(result.accessToken).toBeTruthy();
    expect(result.refreshToken).toBe('new-raw-token');
  });
});
