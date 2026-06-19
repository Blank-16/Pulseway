import {
  SQSClient,
  ReceiveMessageCommand,
  DeleteMessageCommand,
  ChangeMessageVisibilityCommand,
  type Message,
} from '@aws-sdk/client-sqs';
import { getConfig } from '@pulseway/config';
import {
  IncidentRepository,
  MonitorRepository,
  AlertLogRepository,
  NotificationChannelRepository,
} from '@pulseway/db';
import { sendEmail } from './channels/email.js';
import { sendSlack } from './channels/slack.js';
import { sendDiscord } from './channels/discord.js';
import { sendWebhook } from './channels/webhook.js';
import { logger } from './logger.js';
import type { SqsAlertJob, NotificationChannel } from '@pulseway/types';

const INITIAL_BACKOFF_MS = 1_000;
const MAX_BACKOFF_MS     = 30_000;

function sleep(ms: number): Promise<void> { return new Promise((r) => setTimeout(r, ms)); }

export class AlertWorker {
  private readonly sqsClient    : SQSClient;
  private readonly incidentRepo = new IncidentRepository();
  private readonly monitorRepo  = new MonitorRepository();
  private readonly alertLogRepo = new AlertLogRepository();
  private readonly channelRepo  = new NotificationChannelRepository();
  private running               = false;
  private consecutiveErrors     = 0;

  constructor() {
    const config   = getConfig();
    this.sqsClient = new SQSClient({ region: config.AWS_REGION, endpoint: config.AWS_ENDPOINT_URL });
  }

  async start(): Promise<void> {
    this.running = true;
    const config = getConfig();

    while (this.running) {
      try {
        const response = await this.sqsClient.send(
          new ReceiveMessageCommand({
            QueueUrl           : config.ALERT_JOBS_QUEUE_URL,
            MaxNumberOfMessages: 10,
            WaitTimeSeconds    : 20,
            VisibilityTimeout  : 60,
          }),
        );
        this.consecutiveErrors = 0;
        const messages = response.Messages ?? [];
        await Promise.all(messages.map((m) => this.processMessage(m, config.ALERT_JOBS_QUEUE_URL)));
      } catch (err) {
        this.consecutiveErrors++;
        const backoff = Math.min(INITIAL_BACKOFF_MS * 2 ** (this.consecutiveErrors - 1), MAX_BACKOFF_MS);
        logger.error({ err, backoffMs: backoff }, 'AlertWorker poll error');
        await sleep(backoff);
      }
    }
  }

  stop(): void { this.running = false; }

  private async processMessage(message: Message, queueUrl: string): Promise<void> {
    if (!message.Body || !message.ReceiptHandle) return;

    let job: SqsAlertJob;
    try {
      job = JSON.parse(message.Body) as SqsAlertJob;
    } catch {
      logger.error({ messageId: message.MessageId }, 'Unparseable alert job — discarding');
      await this.deleteMessage(queueUrl, message.ReceiptHandle);
      return;
    }

    const log = logger.child({ messageId: message.MessageId, incidentId: job.incidentId, monitorId: job.monitorId });

    try {
      await this.dispatchAlerts(job, log);
      await this.deleteMessage(queueUrl, message.ReceiptHandle);
      log.info({ eventType: job.eventType }, 'Alert dispatched');
    } catch (err) {
      log.error({ err }, 'Alert dispatch failed — returning to queue');
      await this.sqsClient.send(new ChangeMessageVisibilityCommand({
        QueueUrl         : queueUrl,
        ReceiptHandle    : message.ReceiptHandle,
        VisibilityTimeout: 0,
      })).catch(() => null);
    }
  }

  private async dispatchAlerts(job: SqsAlertJob, log: ReturnType<typeof logger.child>): Promise<void> {
    const [incident, monitor, channels] = await Promise.all([
      this.incidentRepo.findById(job.incidentId),
      this.monitorRepo.findById(job.monitorId),
      this.channelRepo.findActiveByWorkspace(job.workspaceId),
    ]);
    if (!incident || !monitor) {
      log.warn('Incident or monitor not found — skipping alert');
      return;
    }

    const config    = getConfig();
    const threshold = config.INCIDENT_CONSECUTIVE_FAILURES_REQUIRED;
    const isOpened  = job.eventType === 'opened';
    const subject   = isOpened
      ? `[ALERT] ${monitor.name} is down`
      : `[RESOLVED] ${monitor.name} is back up`;
    const text = isOpened
      ? `Monitor "${monitor.name}" (${monitor.url}) has failed ${threshold} consecutive checks.\nStarted: ${incident.startedAt}`
      : `Monitor "${monitor.name}" (${monitor.url}) has recovered.\nDuration: ${incident.durationSeconds ?? 0}s`;

    const results = await Promise.allSettled(
      channels.map((ch) => this.sendToChannel(ch, job, subject, text, log)),
    );

    const failures = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
    if (failures.length > 0) {
      throw new Error(`${failures.length}/${channels.length} channels failed`);
    }
  }

  private async sendToChannel(
    channel: NotificationChannel,
    job: SqsAlertJob,
    subject: string,
    text: string,
    log: ReturnType<typeof logger.child>,
  ): Promise<void> {
    const channelLog = log.child({ channelId: channel.id, channelType: channel.channelType });
    try {
      switch (channel.channelType) {
        case 'email':
          await sendEmail({
            to      : [channel.config['to'] ?? ''],
            subject,
            bodyText: text,
            bodyHtml: `<p>${text.replace(/\n/g, '<br>')}</p>`,
          });
          break;
        case 'slack':
          await sendSlack({ webhookUrl: channel.config['webhookUrl'] ?? '', text: subject });
          break;
        case 'discord':
          await sendDiscord({ webhookUrl: channel.config['webhookUrl'] ?? '', content: subject });
          break;
        case 'webhook': {
          const result = await sendWebhook({
            webhookUrl : channel.config['url'] ?? '',
            secret     : channel.config['secret'],
            event      : job.eventType === 'opened' ? 'incident.opened' : 'incident.resolved',
            monitorName: monitor.name,
            monitorUrl : monitor.url,
            incidentId : job.incidentId,
            startedAt  : incident.startedAt,
            durationSec: incident.durationSeconds ?? undefined,
          });
          if (result.status >= 400) {
            throw new Error(`Webhook returned HTTP ${result.status}`);
          }
          break;
        }
      }
      channelLog.info('Channel notified');
      await this.alertLogRepo.insert({ incidentId: job.incidentId, channelType: channel.channelType, status: 'sent' });
    } catch (err) {
      channelLog.error({ err }, 'Channel notification failed');
      await this.alertLogRepo.insert({
        incidentId : job.incidentId,
        channelType: channel.channelType,
        status     : 'failed',
        error      : err instanceof Error ? err.message : 'Unknown error',
      });
      throw err;
    }
  }

  private async deleteMessage(queueUrl: string, receiptHandle: string): Promise<void> {
    await this.sqsClient.send(new DeleteMessageCommand({ QueueUrl: queueUrl, ReceiptHandle: receiptHandle }));
  }
}
