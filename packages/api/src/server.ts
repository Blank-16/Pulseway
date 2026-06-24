import './instrumentation.js';
import { loadConfig, getConfig } from '@pulseway/config';
import { createApp } from './app.js';
import { RedisSubscriber } from './sse/RedisSubscriber.js';
import { closeAllRedisConnections } from './redis.js';
import { closePool } from '@pulseway/db';
import { logger } from './logger.js';
import type { Socket } from 'node:net';

async function main(): Promise<void> {
  await loadConfig();
  const config = getConfig();

  const app             = await createApp();
  const redisSubscriber = new RedisSubscriber(app.sseManager);
  await redisSubscriber.connect();

  const server = app.express.listen(config.API_PORT, () => {
    logger.info({ port: config.API_PORT, env: config.NODE_ENV }, 'API service listening');
  });

  // Track open sockets so we can destroy them during forced shutdown
  const openSockets = new Set<Socket>();
  server.on('connection', (socket: Socket) => {
    openSockets.add(socket);
    socket.once('close', () => openSockets.delete(socket));
  });

  let shuttingDown = false;

  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, 'Graceful shutdown initiated');

    // 1. Stop accepting new connections
    server.close((closeErr) => {
      if (closeErr) logger.error({ err: closeErr }, 'server.close() error');
    });

    // 2. Notify SSE clients so they reconnect cleanly
    app.sseManager.drainAll();

    // 3. Allow in-flight HTTP requests up to 10s to complete
    const DRAIN_TIMEOUT_MS    = 10_000;
    const FORCE_SHUTDOWN_MS   = 15_000;

    const forceExit = setTimeout(() => {
      logger.error({ openSockets: openSockets.size }, 'Forced shutdown — destroying remaining sockets');
      for (const socket of openSockets) socket.destroy();
      process.exit(1);
    }, FORCE_SHUTDOWN_MS);
    forceExit.unref();

    // Give in-flight requests a grace period before we close infrastructure
    await new Promise<void>((resolve) => setTimeout(resolve, DRAIN_TIMEOUT_MS));

    // 4. Disconnect Redis and DB
    try {
      await redisSubscriber.disconnect();
      await closeAllRedisConnections();
      await closePool();
      logger.info('Shutdown complete');
      clearTimeout(forceExit);
      process.exit(0);
    } catch (err) {
      logger.error({ err }, 'Error during shutdown cleanup');
      process.exit(1);
    }
  };

  process.on('SIGTERM', () => { shutdown('SIGTERM').catch(() => process.exit(1)); });
  process.on('SIGINT',  () => { shutdown('SIGINT').catch(() => process.exit(1)); });
  process.on('uncaughtException',  (err)    => { logger.fatal({ err },    'Uncaught exception');  process.exit(1); });
  process.on('unhandledRejection', (reason) => { logger.fatal({ reason }, 'Unhandled rejection'); process.exit(1); });
}

main().catch((err) => {
  // Config not loaded yet — use plain console for fatal startup errors
  // logger may not be initialised if loadConfig() failed — fall back to console
  console.error('Fatal error during startup:', err);
  process.exit(1);
});
