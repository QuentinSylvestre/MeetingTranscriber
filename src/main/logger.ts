import log from 'electron-log';
import { app } from 'electron';
import * as path from 'path';

export function initLogger(): typeof log {
  log.transports.file.resolvePathFn = () =>
    path.join(app.getPath('userData'), 'logs', 'app.log');
  log.transports.file.level = 'info';
  log.transports.file.maxSize = 5 * 1024 * 1024; // 5 MB
  // Rotate: electron-log auto-rotates after maxSize
  log.transports.console.level = process.env.NODE_ENV === 'development' ? 'debug' : 'warn';
  log.info('Logger initialized');
  return log;
}
