/// <reference types="vite/client" />

/**
 * The single declaration of what the preload exposes on window. It previously lived in
 * two hooks with different shapes: TypeScript merges interface declarations but keeps
 * the narrower property type, so every caller of on()/off() failed to compile even
 * though the preload provides them. Keep this file the only place it is declared.
 *
 * Mirrors `ipcApi` in src/preload/index.ts.
 */
declare global {
  interface Window {
    electronAPI: {
      invoke: (channel: string, ...args: unknown[]) => Promise<unknown>;
      on: (channel: string, listener: (...args: unknown[]) => void) => void;
      off: (channel: string, listener: (...args: unknown[]) => void) => void;
    };
    appVersion: { version: string };
  }
}

export {};
