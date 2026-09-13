import { registerSettingsHandlers } from './settings';
import { registerDbHandlers } from './db';
import { registerRecorderHandlers } from './recorder';
import { registerChunkerHandlers } from './chunker';
import { registerTranscriptionHandlers } from './transcription';
import { registerExportHandlers } from './export';
import { registerLifecycleIpcHandlers } from './lifecycle';
import { recoverInterruptedJobs } from '../app-lifecycle';
import { initDb } from '../db/index';

// S2: Guard against double-registration on hot reload. ipcMain.handle throws on duplicate registration.
let handlersRegistered = false;

export function registerAllHandlers(): void {
  if (handlersRegistered) return;
  handlersRegistered = true;
  initDb();
  registerSettingsHandlers();
  registerDbHandlers();
  registerRecorderHandlers();
  registerChunkerHandlers();
  registerTranscriptionHandlers();
  registerExportHandlers();
  registerLifecycleIpcHandlers();
  recoverInterruptedJobs(); // Mark any jobs that were in-progress during a crash as failed
}
