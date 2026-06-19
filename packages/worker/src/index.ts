import { loadConfig, getConfig } from '@pulseway/config';
import { closePool } from '@pulseway/db';
import { CheckWorker } from './CheckWorker.js';
import { AlertWorker } from './AlertWorker.js';
import { DLQWorker } from './DLQWorker.js';
import { closeWorkerRedis } from './redis.js';

async function main(): Promise<void> {
  await loadConfig();
  const config = getConfig();

  // Select queue implementation based on cloud provider
  if (config.CLOUD === 'azure') {
    if (!config.AZURE_SERVICEBUS_CHECK_CONN_STR || !config.AZURE_SERVICEBUS_ALERT_CONN_STR) {
      throw new Error('AZURE_SERVICEBUS_CHECK_CONN_STR and AZURE_SERVICEBUS_ALERT_CONN_STR required when CLOUD=azure');
    }
    // Dynamic import keeps AWS SDK out of the bundle when running on Azure
    const { AzureCheckWorker }  = await import('./AzureCheckWorker.js');
    const { AzureAlertWorker }  = await import('./AzureAlertWorker.js');

    const checkWorker = new AzureCheckWorker();
    const alertWorker = new AzureAlertWorker();
    await boot([checkWorker, alertWorker], [checkWorker, alertWorker]);
  } else {
    const checkWorker = new CheckWorker();
    const alertWorker = new AlertWorker();
    const dlqWorker   = new DLQWorker();
    await boot([checkWorker, alertWorker, dlqWorker], [checkWorker, alertWorker]);
  }
}

interface Stoppable { stop(): void; }
interface Startable  { start(): Promise<void>; }

async function boot(workers: Array<Stoppable & Startable>, stopList: Stoppable[]): Promise<void> {
  let shuttingDown = false;

  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.info(`Received ${signal}. Stopping workers...`);
    for (const w of stopList) w.stop();
    await closeWorkerRedis();
    await closePool();
    console.info('Worker shutdown complete');
    process.exit(0);
  };

  const forceExit = setTimeout(() => {
    console.error('Forced worker shutdown after 30s timeout');
    process.exit(1);
  }, 30_000);
  forceExit.unref();

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT',  () => shutdown('SIGINT'));
  process.on('uncaughtException',  (err)    => { console.error('Uncaught exception:', err);    process.exit(1); });
  process.on('unhandledRejection', (reason) => { console.error('Unhandled rejection:', reason); process.exit(1); });

  await Promise.all(workers.map((w) => w.start()));
}

main().catch((err) => {
  console.error('Fatal worker error:', err);
  process.exit(1);
});
