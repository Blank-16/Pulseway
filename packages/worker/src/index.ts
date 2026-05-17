import { loadConfig } from '@pulseway/config';
import { closePool } from '@pulseway/db';
import { CheckWorker } from './CheckWorker.js';
import { AlertWorker } from './AlertWorker.js';
import { DLQWorker } from './DLQWorker.js';
import { closeWorkerRedis } from './redis.js';

async function main(): Promise<void> {
  await loadConfig();

  const checkWorker = new CheckWorker();
  const alertWorker = new AlertWorker();
  const dlqWorker   = new DLQWorker();

  let shuttingDown = false;

  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.info(`Received ${signal}. Stopping workers...`);

    checkWorker.stop();
    alertWorker.stop();

    // Await in-flight jobs + batcher drain before closing connections
    await checkWorker.disconnect();

    await closeWorkerRedis();
    await closePool();

    console.info('Worker shutdown complete');
    process.exit(0);
  };

  // Force exit if graceful shutdown takes too long
  const forceExit = setTimeout(() => {
    console.error('Forced worker shutdown after timeout');
    process.exit(1);
  }, 30_000);
  forceExit.unref();

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT',  () => shutdown('SIGINT'));
  process.on('uncaughtException',   (err)    => { console.error('Uncaught exception:', err);    process.exit(1); });
  process.on('unhandledRejection',  (reason) => { console.error('Unhandled rejection:', reason); process.exit(1); });

  await Promise.all([checkWorker.start(), alertWorker.start(), dlqWorker.start()]);
}

main().catch((err) => {
  console.error('Fatal worker error:', err);
  process.exit(1);
});
