import { ipcMain } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import log from 'electron-log';
import * as store from '../settings/store';
import type { ProviderName, PreferenceKey, Preferences } from '../../shared/ipc-types';

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
    if (key === 'recordingsFolder' && typeof value !== 'string') {
      return;
    }
    if (key === 'defaultLanguage' && !['fr', 'en', 'auto'].includes(value as string)) {
      return;
    }
    store.setPreference(key, value as Preferences[typeof key]);
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
