import {
  SQSClient,
  ReceiveMessageCommand,
  DeleteMessageCommand,
  type Message,
} from '@aws-sdk/client-sqs';
import { getConfig } from '@pulseway/config';
import { MonitorRepository, getPool } from '@pulseway/db';
import { logger } from './logger.js';
import type { SqsCheckJob } from '@pulseway/types';

const POLL_INTERVAL_MS = 30_000;

function sleep(ms: number): Promise<void> { return new Promise((r) => setTimeout(r, ms)); }

export class DLQWorker {
  private readonly sqsClient  : SQSClient;
  private readonly monitorRepo = new MonitorRepository();
  private running              = false;

  constructor() {
    const config   = getConfig();
    this.sqsClient = new SQSClient({ region: config.AWS_REGION, endpoint: config.AWS_ENDPOINT_URL });
  }

  async start(): Promise<void> {
    this.running = true;
    const config = getConfig();
    if (!config.CHECK_JOBS_DLQ_URL) {
      logger.warn('CHECK_JOBS_DLQ_URL not set — DLQ worker disabled');
      return;
    }
    logger.info('DLQ worker started');

    while (this.running) {
      try {
        const { Messages = [] } = await this.sqsClient.send(new ReceiveMessageCommand({
          QueueUrl           : config.CHECK_JOBS_DLQ_URL,
          MaxNumberOfMessages: 10,
          WaitTimeSeconds    : 20,
        }));

        for (const message of Messages) {
          await this.handleDeadLetter(message, config.CHECK_JOBS_DLQ_URL);
        }

        if (Messages.length === 0) await sleep(POLL_INTERVAL_MS);
      } catch (err) {
        logger.error({ err }, 'DLQ worker poll error');
        await sleep(POLL_INTERVAL_MS);
      }
    }
  }

  stop(): void { this.running = false; }

  private async handleDeadLetter(message: Message, queueUrl: string): Promise<void> {
    if (!message.Body || !message.ReceiptHandle) return;
    logger.warn({ messageId: message.MessageId }, 'Dead letter received');

    try {
      const job  = JSON.parse(message.Body) as SqsCheckJob;
      const pool = getPool();

      // Mark monitor as having failed DLQ processing — operators can inspect
      await pool.query(
        `UPDATE monitors
         SET last_dlq_at = NOW(), dlq_message_id = $1
         WHERE id = $2`,
        [message.MessageId, job.monitorId],
      ).catch(() => null); // column may not exist yet — non-fatal

      // Open an incident if not already open
      const { rows } = await pool.query<{ id: string }>(
        `SELECT id FROM incidents WHERE monitor_id = $1 AND status != 'resolved' LIMIT 1`,
        [job.monitorId],
      );

      if (rows.length === 0) {
        await pool.query(
          `INSERT INTO incidents (monitor_id) VALUES ($1) ON CONFLICT DO NOTHING`,
          [job.monitorId],
        );
        logger.warn({ monitorId: job.monitorId }, 'DLQ: opened incident for dead-lettered monitor');
      }
    } catch (err) {
      logger.error({ err, messageId: message.MessageId }, 'Failed to process dead letter');
    }

    // Always delete from DLQ to prevent re-processing
    await this.sqsClient.send(new DeleteMessageCommand({
      QueueUrl    : queueUrl,
      ReceiptHandle: message.ReceiptHandle,
    })).catch(() => null);
  }
}
