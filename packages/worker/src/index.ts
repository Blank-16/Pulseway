import { loadConfig, getConfig } from '@pulseway/config';
import { closePool } from '@pulseway/db';
import { CheckWorker } from './CheckWorker.js';
import { AlertWorker } from './AlertWorker.js';
import { DLQWorker } from './DLQWorker.js';
import { closeWorkerRedis } from './redis.js';
import pino from 'pino';

// Bootstrap logger — used before config is loaded (LOG_LEVEL unavailable yet)
const bootLogger = pino({
  level : 'info',
  base  : { service: 'worker', pid: process.pid },
  timestamp: pino.stdTimeFunctions.isoTime,
});

async function main(): Promise<void> {
  await loadConfig();

  // Re-import logger now that config is loaded so LOG_LEVEL is respected
  const { logger } = await import('./logger.js');
  const config = getConfig();

  let shuttingDown = false;

  interface Stoppable { stop(): void; }
  interface Startable  { start(): Promise<void>; disconnect?(): Promise<void>; }

  let workers: Array<Stoppable & Startable>;

  if (config.CLOUD === 'azure') {
    if (!config.AZURE_SERVICEBUS_CHECK_CONN_STR || !config.AZURE_SERVICEBUS_ALERT_CONN_STR) {
      bootLogger.fatal('AZURE_SERVICEBUS_CHECK_CONN_STR and AZURE_SERVICEBUS_ALERT_CONN_STR required when CLOUD=azure');
      process.exit(1);
    }
    const { AzureCheckWorker } = await import('./AzureCheckWorker.js');
    const { AzureAlertWorker } = await import('./AzureAlertWorker.js');
    workers = [new AzureCheckWorker(), new AzureAlertWorker()];
    logger.info({ cloud: 'azure' }, 'Workers initialised with Azure Service Bus');
  } else {
    const checkWorker = new CheckWorker();
    const alertWorker = new AlertWorker();
    const dlqWorker   = new DLQWorker();
    workers = [checkWorker, alertWorker, dlqWorker];
    logger.info({ cloud: 'aws' }, 'Workers initialised with AWS SQS');
  }

  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, 'Stopping workers');

    for (const w of workers) w.stop();

    // Await graceful disconnect for each worker
    await Promise.allSettled(
      workers.map((w) => w.disconnect?.() ?? Promise.resolve()),
    );

    await closeWorkerRedis();
    await closePool();
    logger.info('Worker shutdown complete');
    process.exit(0);
  };

  const forceExit = setTimeout(() => {
    bootLogger.error('Forced worker shutdown after 30s timeout');
    process.exit(1);
  }, 30_000);
  forceExit.unref();

  process.on('SIGTERM', () => { shutdown('SIGTERM').catch(() => process.exit(1)); });
  process.on('SIGINT',  () => { shutdown('SIGINT').catch(() => process.exit(1)); });
  process.on('uncaughtException',  (err)    => { logger.fatal({ err },    'Uncaught exception');  process.exit(1); });
  process.on('unhandledRejection', (reason) => { logger.fatal({ reason }, 'Unhandled rejection'); process.exit(1); });

  await Promise.all(workers.map((w) => w.start()));
}

main().catch((err) => {
  bootLogger.fatal({ err }, 'Fatal worker startup error');
  process.exit(1);
});
