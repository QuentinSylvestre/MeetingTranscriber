import { registerSettingsHandlers } from './settings';

// S2: Guard against double-registration on hot reload. ipcMain.handle throws on duplicate registration.
let handlersRegistered = false;

export function registerAllHandlers(): void {
  if (handlersRegistered) return;
  handlersRegistered = true;
  registerSettingsHandlers();
  // Phase 3: registerDbHandlers() will be added here
  // Phase 4: registerRecorderHandlers() will be added here
  // Phase 5: registerChunkerHandlers() will be added here
  // Phase 6: registerTranscriptionHandlers() will be added here
  // Phase 8: registerExportHandlers(), app:reload will be added here
}
