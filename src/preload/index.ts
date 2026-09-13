import { contextBridge, ipcRenderer } from 'electron';
// S7: InvokeChannel is derived from IpcChannels in ipc-types.ts — no manual maintenance.
import type { InvokeChannel } from '../shared/ipc-types';

// Push-event channels: main → renderer only (not invoke channels).
type PushChannel = 'recorder:progress' | 'transcription:progress';

// Map from caller-supplied listener → inner IPC wrapper, so off() can remove the
// exact wrapper that on() registered rather than nuking all listeners on the channel.
const listenerMap = new WeakMap<(...args: unknown[]) => void, (...args: unknown[]) => void>();

export const ipcApi = {
  invoke: (channel: InvokeChannel, ...args: unknown[]): Promise<unknown> =>
    ipcRenderer.invoke(channel, ...args),
  // Register a listener for push events from the main process.
  // The caller is responsible for calling off() with the same function reference
  // to avoid listener leaks (see useRecorder.ts cleanup).
  on: (channel: PushChannel, listener: (...args: unknown[]) => void): void => {
    const wrapper = (_event: unknown, ...args: unknown[]) => listener(...args);
    listenerMap.set(listener, wrapper);
    ipcRenderer.on(channel, wrapper as Parameters<typeof ipcRenderer.on>[1]);
  },
  // Remove the specific listener registered via on(). Falls back to
  // removeAllListeners only when the wrapper is not found (should not happen
  // under normal usage).
  off: (channel: PushChannel, listener: (...args: unknown[]) => void): void => {
    const wrapper = listenerMap.get(listener);
    if (wrapper) {
      ipcRenderer.removeListener(channel, wrapper as Parameters<typeof ipcRenderer.removeListener>[1]);
      listenerMap.delete(listener);
    } else {
      // Fallback: no wrapper found (listener was not registered via on(), or
      // already removed). Remove all listeners as a safe degradation.
      ipcRenderer.removeAllListeners(channel);
    }
  },
};

contextBridge.exposeInMainWorld('electronAPI', ipcApi);
contextBridge.exposeInMainWorld('appVersion', {
  version: process.env.npm_package_version ?? 'unknown',
});
