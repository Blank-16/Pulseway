import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockQuery  = vi.fn();
const mockClient = {
  query  : vi.fn(),
  release: vi.fn(),
};

vi.mock('@pulseway/db', () => ({
  EmailVerificationRepository: vi.fn().mockImplementation(() => ({
    create  : vi.fn(),
    redeem  : vi.fn(),
  })),
}));

vi.mock('../../packages/api/src/channels/email.js', () => ({
  sendEmail: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@pulseway/config', () => ({
  getConfig: vi.fn().mockReturnValue({
    APP_ORIGIN     : 'https://app.pulseway.dev',
    AWS_REGION     : 'us-east-1',
    SES_FROM_ADDRESS: 'noreply@pulseway.dev',
  }),
}));

import { EmailVerificationService } from '../../packages/api/src/services/EmailVerificationService.js';
import { EmailVerificationRepository } from '@pulseway/db';
import { sendEmail } from '../../packages/api/src/channels/email.js';
import { AppError } from '../../packages/api/src/errors.js';

describe('EmailVerificationService', () => {
  let service: EmailVerificationService;
  let repo   : ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new EmailVerificationService();
    repo    = (EmailVerificationRepository as ReturnType<typeof vi.fn>).mock.results.at(-1)?.value;
  });

  it('sendVerificationEmail creates a token and calls sendEmail with a link', async () => {
    repo.create.mockResolvedValue('raw-token-abc');
    await service.sendVerificationEmail('u1', 'user@test.com', 'Alice');

    expect(repo.create).toHaveBeenCalledWith('u1');
    expect(sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to     : ['user@test.com'],
        subject: expect.stringContaining('Verify'),
        bodyText: expect.stringContaining('raw-token-abc'),
      }),
    );
  });

  it('verify calls repo.redeem and returns userId', async () => {
    repo.redeem.mockResolvedValue({ userId: 'u1', tokenId: 'tid' });
    const result = await service.verify('valid-token');
    expect(result.userId).toBe('u1');
    expect(repo.redeem).toHaveBeenCalledWith('valid-token');
  });

  it('verify throws 400 for invalid/expired token', async () => {
    repo.redeem.mockResolvedValue(null);
    await expect(service.verify('bad-token')).rejects.toMatchObject({ statusCode: 400 });
  });
});
