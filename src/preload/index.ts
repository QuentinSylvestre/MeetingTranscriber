import { contextBridge, ipcRenderer } from 'electron';
// S7: InvokeChannel is derived from IpcChannels in ipc-types.ts — no manual maintenance.
import type { InvokeChannel } from '../shared/ipc-types';

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
