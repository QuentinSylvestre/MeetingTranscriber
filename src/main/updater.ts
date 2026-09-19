import { app, dialog, BrowserWindow } from 'electron';
import log from 'electron-log';
import { autoUpdater } from 'electron-updater';

let _initialized = false;

/**
 * Checks GitHub Releases for a newer version, downloads it in the background, and
 * offers to restart once ready. No-op outside a packaged build: unpacked dev/test
 * runs have no code signature and no update feed to check against.
 */
export function initAutoUpdater(getMainWindow: () => BrowserWindow | null): void {
  if (_initialized || !app.isPackaged) return;
  _initialized = true;

  autoUpdater.logger = log;
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('error', (err: Error) => {
    log.error('Auto-update error:', err);
  });

  autoUpdater.on('update-downloaded', async (info) => {
    log.info(`Update ${info.version} downloaded`);
    const win = getMainWindow();
    if (!win) return; // install silently on next quit via autoInstallOnAppQuit
    const { response } = await dialog.showMessageBox(win, {
      type: 'info',
      message: `Update ${info.version} downloaded`,
      detail: 'Restart now to install it, or it will install automatically the next time you quit.',
      buttons: ['Restart Now', 'Later'],
      defaultId: 0,
      cancelId: 1,
    });
    if (response === 0) autoUpdater.quitAndInstall();
  });

  autoUpdater.checkForUpdates().catch((err: Error) => {
    log.error('Update check failed:', err);
  });
}
