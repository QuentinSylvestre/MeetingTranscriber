import { contextBridge } from 'electron';

// Stub — will be populated in Phase 2
// Only expose a version marker for now
contextBridge.exposeInMainWorld('appVersion', {
  version: process.env.npm_package_version ?? 'unknown',
});
