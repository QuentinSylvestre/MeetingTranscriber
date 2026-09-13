import { contextBridge, ipcRenderer } from 'electron';

// Type helper — narrow to known channels
type InvokeChannel =
  | 'settings:has-secret'
  | 'settings:set-secret'
  | 'settings:test-secret'
  | 'settings:get-preference'
  | 'settings:set-preference'
  | 'app:reload';

export const ipcApi = {
  invoke: (channel: InvokeChannel, ...args: unknown[]): Promise<unknown> =>
    ipcRenderer.invoke(channel, ...args),
};

contextBridge.exposeInMainWorld('electronAPI', ipcApi);
contextBridge.exposeInMainWorld('appVersion', {
  version: process.env.npm_package_version ?? 'unknown',
});

// Note: 'on' for push events (e.g. recorder:progress) will be added in Phase 4.
// This file is the ONLY place that calls ipcRenderer — no other renderer file
// should import 'electron' directly.
