import bcrypt from 'bcryptjs';
import { signToken } from '../jwt.js';
import type { Response } from 'express';
import { getConfig } from '@pulseway/config';
import { UserRepository, WorkspaceRepository, RefreshTokenRepository, getPool } from '@pulseway/db';
import { EmailVerificationService } from './EmailVerificationService.js';
import { AppError, ErrorCode } from '../errors.js';
import type { User, Workspace } from '@pulseway/types';

interface AuthTokens {
  accessToken  : string;
  refreshToken : string;
  user         : User;
  workspace    : Workspace;
}

const BCRYPT_ROUNDS       = 12;
const REFRESH_EXPIRY_DAYS = 30;
const COOKIE_NAME         = 'pulseway_refresh';

export class AuthService {
  private readonly userRepo          = new UserRepository();
  private readonly workspaceRepo     = new WorkspaceRepository();
  private readonly refreshTokenRepo  = new RefreshTokenRepository();
  private readonly emailVerification = new EmailVerificationService();

  async register(email: string, password: string, name: string): Promise<AuthTokens> {
    const config = getConfig();

    return getPool().connect().then(async (client) => {
      try {
        await client.query('BEGIN');

        const existing = await client.query<{ id: string }>(
          'SELECT id FROM users WHERE email = $1',
          [email.toLowerCase()],
        );
        if (existing.rows.length > 0) {
          throw new AppError(409, ErrorCode.CONFLICT, 'Email already registered');
        }

        const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
        const { rows: userRows } = await client.query<{
          id: string; email: string; name: string; email_verified: boolean; created_at: Date;
        }>(
          `INSERT INTO users (email, password_hash, name) VALUES ($1, $2, $3) RETURNING *`,
          [email.toLowerCase(), passwordHash, name],
        );
        const userRow = userRows[0]!;

        const baseSlug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48) || 'workspace';
        let slug    = baseSlug;
        let attempt = 0;
        while (true) {
          const { rows } = await client.query<{ id: string }>('SELECT id FROM workspaces WHERE slug = $1', [slug]);
          if (rows.length === 0) break;
          slug = `${baseSlug}-${++attempt}`;
        }

        const { rows: wsRows } = await client.query<{
          id: string; name: string; slug: string; plan: string;
          stripe_customer_id: string | null; stripe_sub_id: string | null; created_at: Date;
        }>(
          `INSERT INTO workspaces (name, slug) VALUES ($1, $2) RETURNING *`,
          [name, slug],
        );
        const wsRow = wsRows[0]!;

        await client.query(
          `INSERT INTO workspace_members (user_id, workspace_id, role) VALUES ($1, $2, 'owner')`,
          [userRow.id, wsRow.id],
        );

        await client.query('COMMIT');

        const user: User = {
          id           : userRow.id,
          email        : userRow.email,
          name         : userRow.name,
          emailVerified: userRow.email_verified,
          createdAt    : userRow.created_at.toISOString(),
        };
        const workspace: Workspace = {
          id              : wsRow.id,
          name            : wsRow.name,
          slug            : wsRow.slug,
          plan            : wsRow.plan as Workspace['plan'],
          stripeCustomerId: wsRow.stripe_customer_id,
          stripeSubId     : wsRow.stripe_sub_id,
          createdAt       : wsRow.created_at.toISOString(),
        };

        const refreshToken = await this.refreshTokenRepo.create(user.id, REFRESH_EXPIRY_DAYS);
        const accessToken  = await this.signJwt(user.id, user.email, workspace.id, 'owner');

        // Fire-and-forget — don't fail registration if SES is down
        this.emailVerification
          .sendVerificationEmail(user.id, user.email, user.name)
          .catch((err) => console.error('Failed to send verification email:', err));

        return { accessToken, refreshToken, user, workspace };
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
    });
  }

  async login(email: string, password: string): Promise<AuthTokens> {
    const userWithHash = await this.userRepo.findByEmail(email.toLowerCase());
    // Always run bcrypt — prevents timing oracle for email enumeration
    const hash    = userWithHash?.passwordHash ?? '$2b$12$invalidhashpaddingtopreventinenumeration';
    const isValid = await bcrypt.compare(password, hash);

    if (!isValid || !userWithHash) {
      throw new AppError(401, ErrorCode.INVALID_CREDENTIALS, 'Invalid email or password');
    }

    if (!userWithHash.emailVerified) {
      throw new AppError(403, ErrorCode.FORBIDDEN, 'Email address not verified. Check your inbox or request a new verification link.');
    }

    const workspaces = await this.workspaceRepo.findUserWorkspaces(userWithHash.id);
    const workspace  = workspaces[0];
    if (!workspace) throw new AppError(403, ErrorCode.FORBIDDEN, 'No workspace found');

    const member = await this.workspaceRepo.findMember(userWithHash.id, workspace.id);
    const role   = member?.role ?? 'viewer';

    const accessToken  = await this.signJwt(userWithHash.id, userWithHash.email, workspace.id, role);
    const refreshToken = await this.refreshTokenRepo.create(userWithHash.id, REFRESH_EXPIRY_DAYS);

    const { passwordHash: _, ...user } = userWithHash;
    return { accessToken, refreshToken, user, workspace };
  }

  async refresh(token: string): Promise<{ accessToken: string; refreshToken: string }> {
    const newRawToken = await this.refreshTokenRepo.rotate(token, REFRESH_EXPIRY_DAYS);
    if (!newRawToken) {
      throw new AppError(401, ErrorCode.UNAUTHORIZED, 'Invalid, expired, or replayed refresh token');
    }

    // Lookup user from the new token (just issued — guaranteed valid)
    const result = await this.refreshTokenRepo.findValid(newRawToken);
    if (!result) throw new AppError(401, ErrorCode.UNAUTHORIZED, 'Token state error');

    const user      = await this.userRepo.findById(result.userId);
    if (!user) throw new AppError(401, ErrorCode.UNAUTHORIZED, 'User not found');

    const workspaces = await this.workspaceRepo.findUserWorkspaces(user.id);
    const workspace  = workspaces[0];
    if (!workspace) throw new AppError(403, ErrorCode.FORBIDDEN, 'No workspace');

    const member      = await this.workspaceRepo.findMember(user.id, workspace.id);
    const role        = member?.role ?? 'viewer';
    const accessToken = await this.signJwt(user.id, user.email, workspace.id, role);

    return { accessToken, refreshToken: newRawToken };
  }

  async logout(token: string): Promise<void> {
    await this.refreshTokenRepo.revoke(token);
  }

  async verifyEmail(token: string): Promise<void> {
    await this.emailVerification.verify(token);
  }

  async resendVerificationEmail(userId: string): Promise<void> {
    const user = await this.userRepo.findById(userId);
    if (!user) throw AppError.notFound('User not found');
    if (user.emailVerified) throw new AppError(409, ErrorCode.CONFLICT, 'Email already verified');
    await this.emailVerification.resend(userId, user.email, user.name);
  }

  setRefreshCookie(res: Response, token: string): void {
    const config = getConfig();
    res.cookie(COOKIE_NAME, token, {
      httpOnly: true,
      secure  : config.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge  : REFRESH_EXPIRY_DAYS * 24 * 60 * 60 * 1000,
      path    : '/api/auth',
    });
  }

  clearRefreshCookie(res: Response): void {
    res.clearCookie(COOKIE_NAME, { path: '/api/auth' });
  }

  private signJwt(userId: string, email: string, workspaceId: string, role: string): Promise<string> {
    return signToken({ sub: userId, email, workspaceId, role });
  }
}
