import { registerSettingsHandlers } from './settings';

export function registerAllHandlers(): void {
  registerSettingsHandlers();
  // Phase 3: registerDbHandlers() will be added here
  // Phase 4: registerRecorderHandlers() will be added here
  // Phase 5: registerChunkerHandlers() will be added here
  // Phase 6: registerTranscriptionHandlers() will be added here
  // Phase 8: registerExportHandlers(), app:reload will be added here
}
