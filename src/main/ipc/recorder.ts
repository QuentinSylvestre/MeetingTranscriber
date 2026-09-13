/**
 * ipc/recorder.ts — IPC handlers for the recording engine.
 *
 * Handles:
 *   recorder:start       — start a new recording session
 *   recorder:pause       — pause the active session
 *   recorder:resume      — resume a paused session
 *   recorder:stop        — stop and flush; resolves when MP3 is written
 *   recorder:pcm-chunk   — forward a batch of PCM Int16 samples to the encoder
 *
 * Push (main → renderer):
 *   recorder:progress    — sent via mainWindow.webContents.send every second
 *                          (wired inside recorder/index.ts startRecording)
 */

import { ipcMain } from 'electron';
import * as recorder from '../recorder/index';
import log from 'electron-log';

export function registerRecorderHandlers(): void {
  ipcMain.handle(
    'recorder:start',
    async (_event, { jobId, audioPath }: { jobId: string; audioPath: string }) => {
      recorder.startRecording(jobId, audioPath);
    }
  );

  ipcMain.handle('recorder:pause', () => {
    recorder.pauseRecording();
  });

  ipcMain.handle('recorder:resume', () => {
    recorder.resumeRecording();
  });

  ipcMain.handle('recorder:stop', async () => {
    try {
      await recorder.stopRecording();
    } catch (err) {
      log.error('Error stopping recording:', err);
      throw err;
    }
  });

  // IPC-batched PCM: the AudioWorklet sends ~50 ms of Int16 samples per call.
  // chunk is a plain number[] (IPC serialises TypedArrays as plain arrays).
  ipcMain.handle(
    'recorder:pcm-chunk',
    (_event, { chunk }: { chunk: number[] }) => {
      // Convert plain number[] back to Int16Array for the encoder Worker.
      recorder.receivePcmChunk(new Int16Array(chunk));
    }
  );
}
