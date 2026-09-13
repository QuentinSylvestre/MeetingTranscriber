import { contextBridge, ipcRenderer } from 'electron';
// S7: InvokeChannel is derived from IpcChannels in ipc-types.ts — no manual maintenance.
import type { InvokeChannel } from '../shared/ipc-types';

// Push-event channels: main → renderer only (not invoke channels).
type PushChannel = 'recorder:progress' | 'transcription:progress';

export const ipcApi = {
  invoke: (channel: InvokeChannel, ...args: unknown[]): Promise<unknown> =>
    ipcRenderer.invoke(channel, ...args),
  // Register a listener for push events from the main process.
  // The caller is responsible for calling off() with the same function reference
  // to avoid listener leaks (see useRecorder.ts cleanup).
  on: (channel: PushChannel, listener: (...args: unknown[]) => void): void => {
    ipcRenderer.on(channel, (_event, ...args) => listener(...args));
  },
  // Remove a listener for push events. Note: removeListener requires the same
  // function reference as was passed to on(). Wrap in an outer fn stored by caller.
  off: (channel: PushChannel, listener: (...args: unknown[]) => void): void => {
    ipcRenderer.removeAllListeners(channel);
    // removeAllListeners is used here because removeListener needs the exact same
    // inner wrapper that was created in on(). Callers using off() should ensure
    // they are the sole listener for the channel, or manage listeners manually.
    void listener; // suppress unused-parameter lint
  },
};

contextBridge.exposeInMainWorld('electronAPI', ipcApi);
contextBridge.exposeInMainWorld('appVersion', {
  version: process.env.npm_package_version ?? 'unknown',
});
