import { app, dialog, BrowserWindow } from 'electron';
import log from 'electron-log';
import { getActiveJobId, cancelJob } from './transcription/runner';
import { getStatus as getRecorderStatus, stopRecording } from './recorder/index';
import { updateJobStatus, listJobs } from './db/jobs';

let _beforeQuitRegistered = false;

export function registerLifecycleHandlers(getMainWindow: () => BrowserWindow | null): void {
  if (_beforeQuitRegistered) return;
  _beforeQuitRegistered = true;

  app.on('before-quit', async (event) => {
    const recorderStatus = getRecorderStatus();
    const activeJobId = getActiveJobId();

    if (recorderStatus === 'recording' || recorderStatus === 'paused') {
      event.preventDefault();
      const win = getMainWindow();
      if (!win) { app.exit(0); return; }
      const response = await dialog.showMessageBox(win, {
        type: 'question',
        message: 'Recording in progress',
        detail: 'Do you want to stop and save the recording, or discard it?',
        buttons: ['Stop & Save', 'Discard', 'Cancel'],
        defaultId: 0,
        cancelId: 2,
      });
      if (response.response === 0) {
        // Stop & Save
        try { await stopRecording(); } catch (err) { log.error('Error stopping recording on quit:', err); }
        app.quit();
      } else if (response.response === 1) {
        // Discard — just quit
        app.quit();
      }
      // response 2 = Cancel: do nothing, app stays open
      return;
    }

    if (activeJobId !== null) {
      event.preventDefault();
      const win = getMainWindow();
      if (!win) { app.exit(0); return; }
      const response = await dialog.showMessageBox(win, {
        type: 'question',
        message: 'Transcription in progress',
        detail: 'Cancel the transcription and quit, or wait for it to finish?',
        buttons: ['Cancel & Quit', 'Wait'],
        defaultId: 1,
        cancelId: 1,
      });
      if (response.response === 0) {
        cancelJob();
        // Wait briefly for cancellation to propagate
        await new Promise(r => setTimeout(r, 500));
        app.quit();
      }
      // response 1 = Wait: do nothing
      return;
    }
  });

  log.info('App lifecycle handlers registered');
}

/**
 * On startup, find any jobs that were in-progress during a crash and mark them failed.
 * Called after the DB is initialized.
 */
export function recoverInterruptedJobs(): void {
  const inProgress = listJobs().filter(j =>
    j.status === 'uploading' || j.status === 'transcribing'
  );
  for (const job of inProgress) {
    log.warn(`Recovering interrupted job ${job.id} (was: ${job.status})`);
    updateJobStatus(job.id, 'failed', 'Interrupted by app close');
  }
  if (inProgress.length > 0) {
    log.info(`Recovered ${inProgress.length} interrupted jobs`);
  }
}
