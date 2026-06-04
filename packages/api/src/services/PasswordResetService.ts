import bcrypt from 'bcryptjs';
import { PasswordResetRepository, UserRepository, RefreshTokenRepository, getPool } from '@pulseway/db';
import { sendEmail } from '../channels/email.js';
import { getConfig } from '@pulseway/config';
import { AppError, ErrorCode } from '../errors.js';

const BCRYPT_ROUNDS = 12;

export class PasswordResetService {
  private readonly repo            = new PasswordResetRepository();
  private readonly userRepo        = new UserRepository();
  private readonly refreshTokenRepo = new RefreshTokenRepository();

  async requestReset(email: string): Promise<void> {
    const config = getConfig();
    const user   = await this.userRepo.findByEmail(email.toLowerCase());
    // Always return success — don't reveal whether the email is registered
    if (!user) return;

    const token = await this.repo.create(user.id);
    const link  = `${config.APP_ORIGIN}/reset-password?token=${token}`;

    await sendEmail({
      to      : [user.email],
      subject : 'Reset your Pulseway password',
      bodyText: `Hi ${user.name},\n\nClick the link below to reset your password:\n\n${link}\n\nThis link expires in 1 hour. If you did not request a reset, ignore this email.`,
      bodyHtml: `
        <p>Hi ${user.name},</p>
        <p>Click the button below to reset your password:</p>
        <p><a href="${link}" style="background:#6366f1;color:#fff;padding:10px 20px;border-radius:6px;text-decoration:none;display:inline-block">Reset Password</a></p>
        <p>This link expires in 1 hour.</p>
        <p>If you did not request a password reset, you can safely ignore this email.</p>
      `.trim(),
    });
  }

  async resetPassword(token: string, newPassword: string): Promise<void> {
    const result = await this.repo.redeem(token);
    if (!result) {
      throw new AppError(400, ErrorCode.BAD_REQUEST, 'Reset link is invalid or has expired');
    }

    const hash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
    const pool = getPool();

    await pool.query(
      'UPDATE users SET password_hash = $1 WHERE id = $2',
      [hash, result.userId],
    );

    // Revoke all active refresh tokens — forces re-login on all devices
    await this.refreshTokenRepo.revokeAllForUser(result.userId);
  }
}
