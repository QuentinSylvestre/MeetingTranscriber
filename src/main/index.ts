import { app, BrowserWindow } from 'electron';
import * as path from 'path';
import { initLogger } from './logger';
import { registerAllHandlers } from './ipc/index';
import { registerAppScheme, registerAppProtocol } from './ipc/protocol';
import { closeDb } from './db/index';
import { registerLifecycleHandlers } from './app-lifecycle';
import { initAutoUpdater } from './updater';

// Logger declared at module scope but initialized after app is ready (F9)
let log: ReturnType<typeof initLogger>;

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true, // Required: SC-7, security best practice, F18
    },
  });

  if (process.env.NODE_ENV === 'development') {
    win.loadURL('http://localhost:5173').catch((err: Error) => {
      log.error('Failed to load dev URL:', err);
    });
  } else {
    // Vite builds the renderer to dist/ and this file to dist-electron/, so the HTML is
    // one level up in dist/. This read '../renderer/index.html' until now, a directory
    // Vite has never emitted, so the packaged window had nothing to load.
    win.loadFile(path.join(__dirname, '../dist/index.html')).catch((err: Error) => {
      log.error('Failed to load app HTML:', err);
    });
  }

  log.info('Application window created');
  return win;
}

// Single-instance lock: two Electron instances must never run concurrently against the
// same userData SQLite database (a stray leftover dev process once raced a real
// migration — harmlessly, but it showed the gap). A second launch attempt quits
// immediately, before registering any handlers, opening a second DB connection, or
// creating a window. (A top-level `return` here would stop only under a CommonJS
// module wrapper and fails `tsc --noEmit` under this project's ESNext module target,
// so the rest of module setup is gated by the `else` branch instead.)
const gotLock = app.requestSingleInstanceLock();

if (!gotLock) {
  app.quit();
} else {
  // registerAppScheme must be called before app.whenReady() — it uses
  // protocol.registerSchemesAsPrivileged which is only valid before the app is ready.
  registerAppScheme();

  app.whenReady().then(() => {
    log = initLogger(); // Safe: app is ready, getPath works (F9)
    registerAllHandlers(); // Register IPC before creating window (includes recoverInterruptedJobs)
    registerAppProtocol(); // Register app:// protocol for audio file access (Phase 8)
    log.info('App ready, creating window');
    createWindow();
    // Wire close guards after window creation so the getter returns the live window
    const getMainWindow = () => BrowserWindow.getAllWindows()[0] ?? null;
    registerLifecycleHandlers(getMainWindow);
    initAutoUpdater(getMainWindow);
    // macOS: re-open window when dock icon is clicked (no-op on Windows) (F11)
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  }).catch((err: Error) => {
    // F9: log may not be initialized if whenReady() rejects before initLogger()
    console.error('Failed to initialize app:', err);
    app.quit();
  });

  // Fires in this (already-running) instance when a second launch is attempted.
  // Bring the existing window to the front instead of letting a second instance run.
  app.on('second-instance', () => {
    const win = BrowserWindow.getAllWindows()[0] ?? null;
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });

  app.on('before-quit', () => {
    closeDb();
  });
}
