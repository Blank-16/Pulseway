import pino from 'pino';
import { getConfig } from '@pulseway/config';

export const logger = pino({
  level    : getConfig().LOG_LEVEL,
  base     : { service: 'scheduler', pid: process.pid },
  timestamp: pino.stdTimeFunctions.isoTime,
  formatters: { level: (label) => ({ level: label }) },
});
