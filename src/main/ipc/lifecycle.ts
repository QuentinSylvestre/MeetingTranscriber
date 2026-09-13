import { ipcMain, app } from 'electron';

export function registerLifecycleIpcHandlers(): void {
  ipcMain.handle('app:reload', () => {
    app.relaunch();
    app.exit(0);
  });
}
