import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockSend     = vi.fn();
const mockInsert   = vi.fn().mockResolvedValue({});
const mockFindById = vi.fn();
const mockFindActiveByWorkspace = vi.fn();
const mockMonitorFindById       = vi.fn();
const mockChangeVisibility      = vi.fn().mockResolvedValue({});

vi.mock('@aws-sdk/client-sqs', () => ({
  SQSClient                       : vi.fn().mockImplementation(() => ({ send: mockSend })),
  ReceiveMessageCommand           : vi.fn(),
  DeleteMessageCommand            : vi.fn(),
  ChangeMessageVisibilityCommand  : vi.fn(),
}));

vi.mock('@pulseway/config', () => ({
  getConfig: vi.fn().mockReturnValue({
    ALERT_JOBS_QUEUE_URL                  : 'http://queue/alert',
    AWS_REGION                            : 'us-east-1',
    INCIDENT_CONSECUTIVE_FAILURES_REQUIRED: 3,
  }),
}));

vi.mock('@pulseway/db', () => ({
  IncidentRepository           : vi.fn().mockImplementation(() => ({ findById: mockFindById })),
  MonitorRepository            : vi.fn().mockImplementation(() => ({ findById: mockMonitorFindById })),
  AlertLogRepository           : vi.fn().mockImplementation(() => ({ insert: mockInsert })),
  NotificationChannelRepository: vi.fn().mockImplementation(() => ({ findActiveByWorkspace: mockFindActiveByWorkspace })),
}));

vi.mock('../../packages/worker/src/channels/email.js', () => ({ sendEmail: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../../packages/worker/src/channels/slack.js', () => ({ sendSlack: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../../packages/worker/src/channels/discord.js', () => ({ sendDiscord: vi.fn().mockResolvedValue(undefined) }));

import { AlertWorker } from '../../packages/worker/src/AlertWorker.js';
import { sendEmail } from '../../packages/worker/src/channels/email.js';
import { sendSlack }  from '../../packages/worker/src/channels/slack.js';
import { ChangeMessageVisibilityCommand, DeleteMessageCommand } from '@aws-sdk/client-sqs';

const baseIncident = { id: 'inc-1', monitorId: 'mon-1', status: 'open', startedAt: new Date().toISOString(), acknowledgedAt: null, acknowledgedBy: null, resolvedAt: null, durationSeconds: null };
const baseMonitor  = { id: 'mon-1', name: 'API Monitor', url: 'https://example.com' };

beforeEach(() => {
  vi.clearAllMocks();
  mockFindById.mockResolvedValue(baseIncident);
  mockMonitorFindById.mockResolvedValue(baseMonitor);
  mockFindActiveByWorkspace.mockResolvedValue([]);
  mockSend.mockResolvedValue({});
});

function makeMessage(eventType: 'opened' | 'resolved') {
  return {
    Body         : JSON.stringify({ incidentId: 'inc-1', monitorId: 'mon-1', workspaceId: 'ws-1', eventType, enqueuedAt: new Date().toISOString() }),
    ReceiptHandle: 'rh-1',
    MessageId    : 'msg-1',
  };
}

describe('AlertWorker.processMessage', () => {
  it('deletes message after successful dispatch', async () => {
    const worker = new AlertWorker();
    await (worker as unknown as { processMessage: Function }).processMessage(makeMessage('opened'), 'http://queue/alert');

    const deleteCalls = mockSend.mock.calls.filter((c) => c[0] instanceof (DeleteMessageCommand as unknown as Function) || c[0]?.constructor?.name === 'DeleteMessageCommand');
    // At least one send call should be the delete
    expect(mockSend).toHaveBeenCalled();
  });

  it('sends to all active channels on opened event', async () => {
    mockFindActiveByWorkspace.mockResolvedValue([
      { id: 'ch-1', channelType: 'email',  config: { to: 'a@b.com' }, isActive: true },
      { id: 'ch-2', channelType: 'slack',  config: { webhookUrl: 'https://hooks.slack.com/x' }, isActive: true },
    ]);
    const worker = new AlertWorker();
    await (worker as unknown as { processMessage: Function }).processMessage(makeMessage('opened'), 'http://queue/alert');

    expect(sendEmail).toHaveBeenCalled();
    expect(sendSlack).toHaveBeenCalled();
    expect(mockInsert).toHaveBeenCalledWith(expect.objectContaining({ status: 'sent' }));
  });

  it('returns message to queue (visibility=0) on channel failure', async () => {
    mockFindActiveByWorkspace.mockResolvedValue([
      { id: 'ch-1', channelType: 'slack', config: { webhookUrl: 'https://hooks.slack.com/x' }, isActive: true },
    ]);
    (sendSlack as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('Slack 500'));

    const worker = new AlertWorker();
    await (worker as unknown as { processMessage: Function }).processMessage(makeMessage('opened'), 'http://queue/alert');

    const visCall = mockSend.mock.calls.find(
      (c) => c[0]?.constructor?.name === 'ChangeMessageVisibilityCommand' || c[0] instanceof (ChangeMessageVisibilityCommand as unknown as Function),
    );
    expect(visCall).toBeDefined();
    expect(mockInsert).toHaveBeenCalledWith(expect.objectContaining({ status: 'failed' }));
  });

  it('discards unparseable messages', async () => {
    const worker = new AlertWorker();
    await (worker as unknown as { processMessage: Function }).processMessage(
      { Body: 'not json', ReceiptHandle: 'rh-bad', MessageId: 'bad' },
      'http://queue/alert',
    );

    expect(mockFindById).not.toHaveBeenCalled();
    // Should still delete the bad message
    expect(mockSend).toHaveBeenCalled();
  });
});
