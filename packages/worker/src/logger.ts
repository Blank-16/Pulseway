import pino from 'pino';
import { getConfig } from '@pulseway/config';

export const logger = pino({
  level      : getConfig().LOG_LEVEL,
  base       : { service: 'worker', pid: process.pid },
  timestamp  : pino.stdTimeFunctions.isoTime,
  formatters : { level: (label) => ({ level: label }) },
});

/**
 * Returns a child logger bound to a specific SQS message so all log lines
 * for a single job carry the same messageId and monitorId.
 */
export function jobLogger(messageId: string, monitorId: string): pino.Logger {
  return logger.child({ messageId, monitorId });
}
