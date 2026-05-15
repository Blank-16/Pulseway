import { EmailVerificationRepository } from '@pulseway/db';
import { sendEmail } from '../channels/email.js';
import { getConfig } from '@pulseway/config';
import { AppError, ErrorCode } from '../errors.js';

export class EmailVerificationService {
  private readonly repo = new EmailVerificationRepository();

  async sendVerificationEmail(userId: string, userEmail: string, userName: string): Promise<void> {
    const config = getConfig();
    const token  = await this.repo.create(userId);
    const link   = `${config.APP_ORIGIN}/verify-email?token=${token}`;

    await sendEmail({
      to      : [userEmail],
      subject : 'Verify your Pulseway email address',
      bodyText: `Hi ${userName},\n\nPlease verify your email by clicking the link below:\n\n${link}\n\nThis link expires in 24 hours.\n\nIf you did not create a Pulseway account, you can safely ignore this email.`,
      bodyHtml: `
        <p>Hi ${userName},</p>
        <p>Please verify your email by clicking the button below:</p>
        <p><a href="${link}" style="background:#6366f1;color:#fff;padding:10px 20px;border-radius:6px;text-decoration:none;display:inline-block">Verify Email</a></p>
        <p>Or copy this link: <code>${link}</code></p>
        <p>This link expires in 24 hours.</p>
        <p>If you did not create a Pulseway account, you can safely ignore this email.</p>
      `.trim(),
    });
  }

  async verify(token: string): Promise<{ userId: string }> {
    const result = await this.repo.redeem(token);
    if (!result) {
      throw new AppError(400, ErrorCode.BAD_REQUEST, 'Verification link is invalid or has expired');
    }
    return { userId: result.userId };
  }

  async resend(userId: string, userEmail: string, userName: string): Promise<void> {
    await this.sendVerificationEmail(userId, userEmail, userName);
  }
}
