import log from 'electron-log';
import { app } from 'electron';
import * as path from 'path';

export function initLogger(): typeof log {
  log.transports.file.resolvePathFn = () =>
    path.join(app.getPath('userData'), 'logs', 'app.log');
  log.transports.file.level = 'info';
  log.transports.file.maxSize = 5 * 1024 * 1024; // 5 MB
  // electron-log auto-rotates after maxSize. Default rotation keeps 1 archive.
  // TODO: upgrade to multi-archive via archiveLog when log volume warrants it.
  log.transports.console.level = process.env.NODE_ENV === 'development' ? 'debug' : 'warn';
  // NOTE: do NOT call log.info() here — initLogger() is called inside app.whenReady()
  // so app.getPath() is safe, but avoiding a gratuitous first write keeps tests clean.
  return log;
}
