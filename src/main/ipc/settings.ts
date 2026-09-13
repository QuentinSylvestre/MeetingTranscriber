import { ipcMain } from 'electron';
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
}
