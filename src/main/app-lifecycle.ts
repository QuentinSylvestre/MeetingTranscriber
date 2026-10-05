import { app, dialog, BrowserWindow } from 'electron';
import log from 'electron-log';
import { getActiveJobId, cancelJob } from './transcription/runner';
import { getStatus as getRecorderStatus, stopRecording, getAudioPath, waitForStart } from './recorder/index';
import { registerRecoveredRecording, clearRecordingMarker } from './recorder/recovery';
import { updateJobStatus, listJobs } from './db/jobs';
import { msg, msgList } from './messages';

let _beforeQuitRegistered = false;
let _quitInProgress = false;

function hasActiveWork(): boolean {
  return getRecorderStatus() !== 'idle' || getActiveJobId() !== null;
}

/**
 * Settles whatever is in flight before the app goes away, asking the user when there is a
 * window to ask through. Returns false when the user cancels (stay open), true when it is
 * safe to close.
 *
 * One function for both entry points. Closing the window on Windows destroys it before
 * `window-all-closed` fires, so the quit path used to find no window to put a dialog in
 * and exited at once, skipping the question and the flush. The window's own `close` event
 * is the last moment the window still exists, so the guard now lives there too.
 */
export async function confirmCloseWithActiveWork(win: BrowserWindow | null): Promise<boolean> {
  // A recorder still starting has no file and no encoder worth asking about yet: let the
  // start finish, then decide on what it produced (a recording, or nothing).
  if (getRecorderStatus() === 'starting') await waitForStart();
  const recorderStatus = getRecorderStatus();

  if (recorderStatus === 'recording' || recorderStatus === 'paused') {
    // With no window to ask through, saving is the only choice that cannot lose audio.
    let response = 0;
    if (win && !win.isDestroyed()) {
      ({ response } = await dialog.showMessageBox(win, {
        type: 'question',
        message: msg('close_recording_message'),
        detail: msg('close_recording_detail'),
        buttons: msgList('close_recording_buttons'),
        defaultId: 0,
        cancelId: 2,
      }));
    }
    if (response === 2) return false;

    const audioPath = getAudioPath();
    try { await stopRecording(); } catch (err) { log.error('Error stopping recording on close:', err); }
    if (audioPath) {
      // Discard keeps the file, as it always has: it only declines to list it. Deleting
      // hours of a meeting on one click, with no way back, is not a decision to make here.
      // The marker is cleared either way so the next launch does not list it after all.
      if (response !== 1) {
        try { registerRecoveredRecording(audioPath); } catch (err) { log.error('Could not add the recording to History:', err); }
      }
      clearRecordingMarker(audioPath);
    }
  } else if (recorderStatus === 'stopping') {
    try { await stopRecording(); } catch (err) { log.error('Error settling recorder on close:', err); }
  }

  if (getActiveJobId() !== null) {
    // After a recording was just handled, the job is cancelled without a second question,
    // as before. Otherwise ask, unless there is no window to ask through.
    let cancel = true;
    if (recorderStatus === 'idle' && win && !win.isDestroyed()) {
      const response = await dialog.showMessageBox(win, {
        type: 'question',
        message: msg('close_transcription_message'),
        detail: msg('close_transcription_detail'),
        buttons: msgList('close_transcription_buttons'),
        defaultId: 1,
        cancelId: 1,
      });
      cancel = response.response === 0;
    }
    if (!cancel) return false;
    cancelJob();
    // Wait briefly for cancellation to propagate
    await new Promise(r => setTimeout(r, 500));
  }
  return true;
}

/**
 * Intercepts the window's own close so the question is asked while the window still exists.
 * Once the user has agreed, the window is closed for real and the normal quit proceeds.
 */
export function registerWindowCloseGuard(win: BrowserWindow): void {
  let approved = false;
  let asking = false;
  win.on('close', (event) => {
    if (approved || !hasActiveWork()) return;
    event.preventDefault();
    if (asking) return;
    asking = true;
    void confirmCloseWithActiveWork(win)
      .then((ok) => {
        if (ok) {
          approved = true;
          if (!win.isDestroyed()) win.close();
        }
      })
      .catch((err) => log.error('Close confirmation failed:', err))
      .finally(() => { asking = false; });
  });
}

export function registerLifecycleHandlers(getMainWindow: () => BrowserWindow | null): void {
  if (_beforeQuitRegistered) return;
  _beforeQuitRegistered = true;

  // Reached for quits that do not come from a window close: the updater's "Restart Now",
  // a menu Quit. The window is normally still alive here.
  app.on('before-quit', async (event) => {
    // Guard: prevent re-entry when app.quit() is called from inside a dialog callback
    if (_quitInProgress) return;
    if (!hasActiveWork()) return;

    event.preventDefault();
    const ok = await confirmCloseWithActiveWork(getMainWindow());
    if (!ok) return;
    _quitInProgress = true;
    app.quit();
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
