import './instrumentation.js';
import 'node:process';
import { loadConfig, getConfig } from '@pulseway/config';
import { createApp } from './app.js';
import { RedisSubscriber } from './sse/RedisSubscriber.js';
import { closeAllRedisConnections } from './redis.js';
import { getPool } from '@pulseway/db';
import { logger } from './logger.js';

async function main(): Promise<void> {
  await loadConfig();
  const config = getConfig();

  const app = await createApp();
  const redisSubscriber = new RedisSubscriber(app.sseManager);
  await redisSubscriber.connect();

  const server = app.express.listen(config.API_PORT, () => {
    logger.info({ port: config.API_PORT }, 'API service listening');
  });

  const shutdown = async (signal: string): Promise<void> => {
    logger.info({ signal }, 'Graceful shutdown initiated');

    // 1. Stop accepting new connections
    server.close(async () => {
      // 2. Drain all SSE connections so clients reconnect cleanly
      app.sseManager.drainAll();

      // 3. Disconnect Redis and DB
      await redisSubscriber.disconnect();
      await closeAllRedisConnections();
      await getPool().end();

      logger.info('Shutdown complete');
      process.exit(0);
    });

    // Force exit if graceful shutdown takes too long
    setTimeout(() => {
      logger.error('Forced shutdown after timeout');
      process.exit(1);
    }, 15_000).unref();
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('uncaughtException', (err) => {
    logger.fatal({ err }, 'Uncaught exception');
    process.exit(1);
  });
  process.on('unhandledRejection', (reason) => {
    logger.fatal({ reason }, 'Unhandled rejection');
    process.exit(1);
  });
}

main().catch((err) => {
  console.error('Fatal error during startup:', err);
  process.exit(1);
});
