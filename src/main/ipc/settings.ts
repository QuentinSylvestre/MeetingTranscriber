import { ipcMain } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import log from 'electron-log';
import * as store from '../settings/store';
import type { ProviderName, PreferenceKey, Preferences, PricingRates } from '../../shared/ipc-types';
import { PROVIDER_NAMES } from '../../shared/ipc-types';

function isFiniteNonNegative(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0;
}

// Runtime type guard for the pricingRates preference. A malformed value here would
// silently produce NaN/wrong displayed costs downstream rather than an obviously
// rejected write, so this checks every leaf (finite, non-negative) and that every
// expected sub-object is present — not just a shallow `typeof value === 'object'`.
export function isValidPricingRates(value: unknown): value is PricingRates {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  const { assemblyai, elevenlabs, openaiTranscribe, openaiSummary, google } = v;
  if (typeof assemblyai !== 'object' || assemblyai === null) return false;
  if (typeof elevenlabs !== 'object' || elevenlabs === null) return false;
  if (typeof openaiTranscribe !== 'object' || openaiTranscribe === null) return false;
  if (typeof openaiSummary !== 'object' || openaiSummary === null) return false;
  if (typeof google !== 'object' || google === null) return false;
  const a = assemblyai as Record<string, unknown>;
  const e = elevenlabs as Record<string, unknown>;
  const ot = openaiTranscribe as Record<string, unknown>;
  const os = openaiSummary as Record<string, unknown>;
  const g = google as Record<string, unknown>;
  return (
    isFiniteNonNegative(a.universal35ProPerHourUsd) &&
    isFiniteNonNegative(a.universal2PerHourUsd) &&
    isFiniteNonNegative(a.diarizationPerHourUsd) &&
    isFiniteNonNegative(e.perHourUsd) &&
    isFiniteNonNegative(ot.inputPerMillionUsd) &&
    isFiniteNonNegative(ot.outputPerMillionUsd) &&
    isFiniteNonNegative(os.inputPerMillionUsd) &&
    isFiniteNonNegative(os.outputPerMillionUsd) &&
    isFiniteNonNegative(os.cachedInputPerMillionUsd) &&
    isFiniteNonNegative(g.inputPerMillionUsd) &&
    isFiniteNonNegative(g.outputPerMillionUsd)
  );
}

export function registerSettingsHandlers(): void {
  ipcMain.handle('settings:has-secret', (_event, { key }: { key: string }) => {
    return { present: store.hasSecret(key) };
  });

  // S4: Returns structured result so renderer can detect encryption_unavailable failures.
  ipcMain.handle('settings:set-secret', (_event, { key, value }: { key: string; value: string }) => {
    return store.setSecret(key, value);
  });

  // INTENTIONALLY ABSENT: 'settings:get-secret' — renderer never receives plaintext keys

  ipcMain.handle('settings:test-secret', async (_event, { key, provider }: { key: string; provider: ProviderName }) => {
    log.info(`Testing secret for provider: ${provider} (key: ${key})`);
    return store.testSecret(key, provider);
  });

  ipcMain.handle('settings:get-preference', (_event, { key }: { key: PreferenceKey }) => {
    return { value: store.getPreference(key) };
  });

  // S6: Runtime validation at the IPC boundary — removes `as never` type erasure.
  ipcMain.handle('settings:set-preference', (_event, { key, value }: { key: PreferenceKey; value: unknown }) => {
    if (key === 'recordingsFolder' && typeof value !== 'string') { return; }
    else if (key === 'defaultLanguage' && !['fr', 'en', 'auto'].includes(value as string)) { return; }
    else if (key === 'defaultProvider' && !(PROVIDER_NAMES as string[]).includes(value as string)) { return; }
    else if (key === 'appLanguage' && !(['fr', 'en'] as string[]).includes(value as string)) { return; }
    // Per-key type validation (guards before the catch-all allowlist below)
    else if (key === 'includeTimestamps' && typeof value !== 'boolean') { return; }
    else if (key === 'fontSize' && (![14, 16, 18, 20].includes(value as number))) { return; }
    else if (key === 'pricingRates' && !isValidPricingRates(value)) { return; }
    else if (!(['recordingsFolder', 'defaultLanguage', 'defaultProvider', 'appLanguage', 'includeTimestamps', 'fontSize', 'pricingRates'] as string[]).includes(key)) { return; }
    store.setPreference(key, value as Preferences[typeof key]);
  });

  // Open a native file picker and return the selected absolute path (or null if cancelled).
  ipcMain.handle('settings:pick-audio-file', async (_event, { extensions }: { extensions: string[] }) => {
    const { dialog } = await import('electron');
    const result = await dialog.showOpenDialog({
      properties: ['openFile'],
      filters: [{ name: 'Audio files', extensions: extensions.map(e => e.replace(/^\./, '')) }],
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    return result.filePaths[0];
  });

  // Copy an uploaded file into the recordings folder so it passes path confinement checks.
  // Returns the destination absolute path.
  ipcMain.handle('settings:copy-upload', (_event, { srcPath, jobId, fileName }: { srcPath: string; jobId: string; fileName: string }) => {
    if (!srcPath || !path.isAbsolute(srcPath)) {
      throw new Error('srcPath must be an absolute path');
    }
    const recordingsFolder = store.getPreference('recordingsFolder');
    const ext = path.extname(fileName) || '.audio';
    const destName = `upload-${jobId}${ext}`;
    const destPath = path.join(recordingsFolder, destName);
    fs.mkdirSync(recordingsFolder, { recursive: true });
    fs.copyFileSync(srcPath, destPath);
    log.info(`Copied upload ${srcPath} -> ${destPath}`);
    return destPath;
  });
}
