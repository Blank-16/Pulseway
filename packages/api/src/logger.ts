import pino from 'pino';

// Logger is initialised at import time — before loadConfig() runs.
// We read LOG_LEVEL directly from process.env here because pino needs a level
// at construction time; getConfig() would throw if called before loadConfig().
// After loadConfig() runs, the level can be updated via logger.level = getConfig().LOG_LEVEL.
const VALID_LEVELS = new Set(['trace', 'debug', 'info', 'warn', 'error', 'fatal']);

function resolveLevel(): string {
  const fromEnv = process.env['LOG_LEVEL'];
  if (fromEnv && VALID_LEVELS.has(fromEnv)) return fromEnv;
  return process.env['NODE_ENV'] === 'production' ? 'info' : 'debug';
}

export const logger = pino({
  level    : resolveLevel(),
  base     : { service: 'api', pid: process.pid },
  timestamp: pino.stdTimeFunctions.isoTime,
  formatters: { level: (label) => ({ level: label }) },
  ...(process.env['NODE_ENV'] !== 'production' && {
    transport: {
      target : 'pino-pretty',
      options: { colorize: true, ignore: 'pid,hostname' },
    },
  }),
});
