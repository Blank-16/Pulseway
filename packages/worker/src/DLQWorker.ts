import {
  SQSClient,
  ReceiveMessageCommand,
  DeleteMessageCommand,
  type Message,
} from '@aws-sdk/client-sqs';
import { getConfig } from '@pulseway/config';
import { IncidentRepository, getPool } from '@pulseway/db';
import { logger } from './logger.js';
import type { SqsCheckJob } from '@pulseway/types';

const POLL_INTERVAL_MS  = 30_000;
const INITIAL_BACKOFF   = 1_000;
const MAX_BACKOFF        = 60_000;

function sleep(ms: number): Promise<void> { return new Promise((r) => setTimeout(r, ms)); }

export class DLQWorker {
  private readonly sqsClient    : SQSClient;
  private readonly incidentRepo = new IncidentRepository();
  private running               = false;
  private consecutiveErrors     = 0;

  constructor() {
    const config   = getConfig();
    this.sqsClient = new SQSClient({ region: config.AWS_REGION, endpoint: config.AWS_ENDPOINT_URL } as any);
  }

  async start(): Promise<void> {
    this.running = true;
    const config = getConfig();

    if (!config.CHECK_JOBS_DLQ_URL) {
      logger.warn('CHECK_JOBS_DLQ_URL not set — DLQ worker disabled');
      return;
    }

    logger.info({ queueUrl: config.CHECK_JOBS_DLQ_URL }, 'DLQ worker started');

    while (this.running) {
      try {
        const { Messages = [] } = await this.sqsClient.send(new ReceiveMessageCommand({
          QueueUrl           : config.CHECK_JOBS_DLQ_URL,
          MaxNumberOfMessages: 10,
          WaitTimeSeconds    : 20,
        }));

        this.consecutiveErrors = 0;

        for (const message of Messages) {
          await this.handleDeadLetter(message, config.CHECK_JOBS_DLQ_URL);
        }

        if (Messages.length === 0) await sleep(POLL_INTERVAL_MS);
      } catch (err) {
        this.consecutiveErrors++;
        const backoff = Math.min(INITIAL_BACKOFF * 2 ** (this.consecutiveErrors - 1), MAX_BACKOFF);
        logger.error({ err, backoffMs: backoff }, 'DLQ worker poll error');
        await sleep(backoff);
      }
    }
  }

  stop(): void { this.running = false; }

  private async handleDeadLetter(message: Message, queueUrl: string): Promise<void> {
    if (!message.Body || !message.ReceiptHandle) return;

    logger.warn({ messageId: message.MessageId }, 'Dead letter received — processing');

    let job: SqsCheckJob | null = null;
    try {
      job = JSON.parse(message.Body) as SqsCheckJob;
    } catch (err) {
      logger.error({ err, messageId: message.MessageId }, 'DLQ: unparseable message body — discarding');
      await this.deleteMessage(queueUrl, message.ReceiptHandle);
      return;
    }

    try {
      // Use IncidentRepository.insert which holds an advisory lock — prevents duplicates
      // even if multiple DLQ workers process the same monitor concurrently
      const existing = await this.incidentRepo.findOpenByMonitorId(job.monitorId);
      if (!existing) {
        const incident = await this.incidentRepo.insert(job.monitorId);
        await this.incidentRepo.appendTimeline(
          incident.id,
          'incident_opened',
          `Opened by DLQ worker — check job failed after ${3} attempts (messageId: ${message.MessageId ?? 'unknown'})`,
          null,
        );
        logger.warn(
          { incidentId: incident.id, monitorId: job.monitorId, messageId: message.MessageId },
          'DLQ: opened incident for dead-lettered monitor',
        );
      } else {
        logger.debug(
          { incidentId: existing.id, monitorId: job.monitorId },
          'DLQ: incident already open — not creating duplicate',
        );
      }

      // Record DLQ event in a best-effort audit note
      const pool = getPool();
      await pool.query(
        `UPDATE monitors SET dlq_message_id = $1, last_dlq_at = NOW() WHERE id = $2`,
        [message.MessageId ?? null, job.monitorId],
      ).catch(() => null); // Column may not exist in all environments — non-fatal

    } catch (err) {
      logger.error({ err, monitorId: job.monitorId, messageId: message.MessageId }, 'DLQ: failed to process dead letter');
      // Do not delete — let it expire and notify via DLQ depth alert
      return;
    }

    await this.deleteMessage(queueUrl, message.ReceiptHandle);
  }

  private async deleteMessage(queueUrl: string, receiptHandle: string): Promise<void> {
    await this.sqsClient.send(new DeleteMessageCommand({ QueueUrl: queueUrl, ReceiptHandle: receiptHandle }));
  }
}
