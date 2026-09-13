import { ipcMain } from 'electron';
import log from 'electron-log';
import * as store from '../settings/store';
import type { ProviderName, PreferenceKey } from '../../shared/ipc-types';

export function registerSettingsHandlers(): void {
  ipcMain.handle('settings:has-secret', (_event, { key }: { key: string }) => {
    return { present: store.hasSecret(key) };
  });

  ipcMain.handle('settings:set-secret', (_event, { key, value }: { key: string; value: string }) => {
    store.setSecret(key, value);
  });

  // INTENTIONALLY ABSENT: 'settings:get-secret' — renderer never receives plaintext keys

  ipcMain.handle('settings:test-secret', async (_event, { key, provider }: { key: string; provider: ProviderName }) => {
    log.info(`Testing secret for provider: ${provider} (key: ${key})`);
    return store.testSecret(key, provider);
  });

  ipcMain.handle('settings:get-preference', (_event, { key }: { key: PreferenceKey }) => {
    return { value: store.getPreference(key) };
  });

  ipcMain.handle('settings:set-preference', (_event, { key, value }: { key: PreferenceKey; value: unknown }) => {
    store.setPreference(key, value as never);
  });
}
