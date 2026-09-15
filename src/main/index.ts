import { app, BrowserWindow } from 'electron';
import * as path from 'path';
import { initLogger } from './logger';
import { registerAllHandlers } from './ipc/index';
import { registerAppScheme, registerAppProtocol } from './ipc/protocol';
import { closeDb } from './db/index';
import { registerLifecycleHandlers } from './app-lifecycle';

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
    win.loadFile(path.join(__dirname, '../renderer/index.html')).catch((err: Error) => {
      log.error('Failed to load app HTML:', err);
    });
  }

  log.info('Application window created');
  return win;
}

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
  registerLifecycleHandlers(() => BrowserWindow.getAllWindows()[0] ?? null);
  // macOS: re-open window when dock icon is clicked (no-op on Windows) (F11)
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
}).catch((err: Error) => {
  // F9: log may not be initialized if whenReady() rejects before initLogger()
  console.error('Failed to initialize app:', err);
  app.quit();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  closeDb();
});
