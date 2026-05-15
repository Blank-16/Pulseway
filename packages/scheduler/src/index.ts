import { loadConfig } from '@pulseway/config';
import { closePool } from '@pulseway/db';
import { SchedulerLoop } from './SchedulerLoop.js';

async function main(): Promise<void> {
  await loadConfig();
  const loop = new SchedulerLoop();

  const shutdown = async (signal: string): Promise<void> => {
    console.info(`Received ${signal}. Stopping scheduler...`);
    loop.stop();
    await loop.disconnect();
    await closePool();
    process.exit(0);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('uncaughtException', (err) => { console.error('Uncaught exception:', err); process.exit(1); });
  process.on('unhandledRejection', (r) => { console.error('Unhandled rejection:', r); process.exit(1); });

  await loop.start();
}

main().catch((err) => { console.error('Fatal scheduler error:', err); process.exit(1); });
