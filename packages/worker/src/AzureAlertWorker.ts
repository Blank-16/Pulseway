import { getConfig } from '@pulseway/config';
import { IncidentRepository, MonitorRepository, AlertLogRepository, NotificationChannelRepository } from '@pulseway/db';
import { sendEmail } from './channels/email.js';
import { sendSlack } from './channels/slack.js';
import { sendDiscord } from './channels/discord.js';
import { sendWebhook } from './channels/webhook.js';
import { logger } from './logger.js';
import { ServiceBusAdapter, ServiceBusSender } from './queue/ServiceBusAdapter.js';
import type { SqsAlertJob, NotificationChannel } from '@pulseway/types';

const INITIAL_BACKOFF_MS = 1_000;
const MAX_BACKOFF_MS     = 30_000;

function sleep(ms: number): Promise<void> { return new Promise((r) => setTimeout(r, ms)); }

/**
 * Azure-specific AlertWorker using Service Bus instead of SQS.
 * Identical dispatch logic to AlertWorker.
 */
export class AzureAlertWorker {
  private readonly adapter      : ServiceBusAdapter;
  private readonly incidentRepo = new IncidentRepository();
  private readonly monitorRepo  = new MonitorRepository();
  private readonly alertLogRepo = new AlertLogRepository();
  private readonly channelRepo  = new NotificationChannelRepository();
  private running               = false;
  private consecutiveErrors     = 0;

  constructor() {
    this.adapter = new ServiceBusAdapter(getConfig().AZURE_SERVICEBUS_ALERT_CONN_STR!);
  }

  async start(): Promise<void> {
    this.running = true;
    logger.info({ cloud: 'azure' }, 'AzureAlertWorker started');

    while (this.running) {
      try {
        const messages = await this.adapter.receiveMessages('alert-jobs', 10);
        this.consecutiveErrors = 0;
        await Promise.all(messages.map((m) => this.processMessage(m)));
        if (messages.length === 0) await sleep(1_000);
      } catch (err) {
        this.consecutiveErrors++;
        const backoff = Math.min(INITIAL_BACKOFF_MS * 2 ** (this.consecutiveErrors - 1), MAX_BACKOFF_MS);
        logger.error({ err, backoffMs: backoff }, 'AzureAlertWorker poll error');
        await sleep(backoff);
      }
    }
  }

  stop(): void { this.running = false; }

  private async processMessage(
    message: { messageId?: string; body: string; receiptHandle: string },
  ): Promise<void> {
    let job: SqsAlertJob;
    try {
      job = JSON.parse(message.body) as SqsAlertJob;
    } catch {
      logger.error({ messageId: message.messageId }, 'Unparseable alert job — discarding');
      await this.adapter.deleteMessage('alert-jobs', message.receiptHandle);
      return;
    }

    const log = logger.child({ messageId: message.messageId, incidentId: job.incidentId, monitorId: job.monitorId });

    try {
      await this.dispatchAlerts(job, log);
      await this.adapter.deleteMessage('alert-jobs', message.receiptHandle);
      log.info({ eventType: job.eventType }, 'Alert dispatched');
    } catch (err) {
      log.error({ err }, 'Alert dispatch failed — abandoning for retry');
      await this.adapter.abandonMessage('alert-jobs', message.receiptHandle);
    }
  }

  private async dispatchAlerts(job: SqsAlertJob, log: ReturnType<typeof logger.child>): Promise<void> {
    const [incident, monitor, channels] = await Promise.all([
      this.incidentRepo.findById(job.incidentId),
      this.monitorRepo.findById(job.monitorId),
      this.channelRepo.findActiveByWorkspace(job.workspaceId),
    ]);
    if (!incident || !monitor) { log.warn('Incident or monitor not found'); return; }

    const config    = getConfig();
    const threshold = config.INCIDENT_CONSECUTIVE_FAILURES_REQUIRED;
    const isOpened  = job.eventType === 'opened';
    const subject   = isOpened ? `[ALERT] ${monitor.name} is down` : `[RESOLVED] ${monitor.name} is back up`;
    const text      = isOpened
      ? `Monitor "${monitor.name}" (${monitor.url}) has failed ${threshold} consecutive checks.\nStarted: ${incident.startedAt}`
      : `Monitor "${monitor.name}" (${monitor.url}) has recovered.\nDuration: ${incident.durationSeconds ?? 0}s`;

    const results = await Promise.allSettled(
      channels.map((ch) => this.sendToChannel(ch, job, subject, text, log)),
    );

    const failures = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
    if (failures.length > 0) throw new Error(`${failures.length}/${channels.length} channels failed`);
  }

  private async sendToChannel(
    channel: NotificationChannel, job: SqsAlertJob,
    subject: string, text: string, log: ReturnType<typeof logger.child>,
  ): Promise<void> {
    const clog = log.child({ channelId: channel.id, channelType: channel.channelType });
    try {
      switch (channel.channelType) {
        case 'email':
          await sendEmail({ to: [channel.config['to'] ?? ''], subject, bodyText: text, bodyHtml: `<p>${text.replace(/\n/g, '<br>')}</p>` });
          break;
        case 'slack':
          await sendSlack({ webhookUrl: channel.config['webhookUrl'] ?? '', text: subject });
          break;
        case 'discord':
          await sendDiscord({ webhookUrl: channel.config['webhookUrl'] ?? '', content: subject });
          break;
        case 'webhook':
          await sendWebhook({ webhookUrl: channel.config['url'] ?? '', secret: channel.config['secret'], event: job.eventType === 'opened' ? 'incident.opened' : 'incident.resolved', monitorName: 'unknown', monitorUrl: '', incidentId: job.incidentId, startedAt: new Date().toISOString() });
          break;
      }
      clog.info('Channel notified');
      await this.alertLogRepo.insert({ incidentId: job.incidentId, channelType: channel.channelType, status: 'sent' });
    } catch (err) {
      clog.error({ err }, 'Channel notification failed');
      await this.alertLogRepo.insert({ incidentId: job.incidentId, channelType: channel.channelType, status: 'failed', error: err instanceof Error ? err.message : 'Unknown' });
      throw err;
    }
  }
}
