import { loadConfig } from '@pulseway/config';
import { closePool } from '@pulseway/db';
import { SchedulerLoop } from './SchedulerLoop.js';
import pino from 'pino';

// Bootstrap logger before config is loaded (LOG_LEVEL may not be available yet)
const bootLogger = pino({ level: 'info', base: { service: 'scheduler', pid: process.pid } });

async function main(): Promise<void> {
  await loadConfig();

  // Re-import logger now that config is loaded
  const { logger } = await import('./logger.js');
  const loop = new SchedulerLoop();

  let shuttingDown = false;

  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, 'Stopping scheduler');
    loop.stop();
    await loop.disconnect();
    await closePool();
    logger.info('Scheduler shutdown complete');
    process.exit(0);
  };

  const forceExit = setTimeout(() => {
    bootLogger.error('Forced scheduler shutdown after 15s timeout');
    process.exit(1);
  }, 15_000);
  forceExit.unref();

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT',  () => shutdown('SIGINT'));
  process.on('uncaughtException',  (err)    => { logger.error({ err },    'Uncaught exception');  process.exit(1); });
  process.on('unhandledRejection', (reason) => { logger.error({ reason }, 'Unhandled rejection'); process.exit(1); });

  await loop.start();
}

main().catch((err) => {
  bootLogger.error({ err }, 'Fatal scheduler error');
  process.exit(1);
});
