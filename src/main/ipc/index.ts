import { registerSettingsHandlers } from './settings';
import { registerDbHandlers } from './db';
import { registerRecorderHandlers } from './recorder';
import { registerChunkerHandlers } from './chunker';
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
  // Phase 6: registerTranscriptionHandlers() will be added here
  // Phase 8: registerExportHandlers(), app:reload will be added here
}
