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

import * as path from 'path';
import { ipcMain } from 'electron';
import * as recorder from '../recorder/index';
import { getActiveJobId as getTranscriptionActiveJobId } from '../transcription/runner';
import { getPreference } from '../settings/store';
import log from 'electron-log';

export function registerRecorderHandlers(): void {
  ipcMain.handle(
    'recorder:start',
    async (_event, { jobId }: { jobId: string; micDeviceId?: string; enableLoopback?: boolean }) => {
      // F1 Reliability: mutual exclusion — reject if a transcription job is active.
      if (getTranscriptionActiveJobId() !== null) {
        throw new Error('Cannot start recording while a transcription job is active');
      }
      // Build absolute audioPath in main process (F1/F2/F5: renderer must not supply path).
      const recordingsFolder = getPreference('recordingsFolder');
      const audioPath = path.join(recordingsFolder, `${jobId}.mp3`);
      await recorder.startRecording(jobId, audioPath);
    }
  );

  ipcMain.handle('recorder:pause', () => {
    recorder.pauseRecording();
  });

  ipcMain.handle('recorder:resume', () => {
    recorder.resumeRecording();
  });

  // Never rejects for an encoder failure: the file on disk is still the user's recording,
  // so the renderer needs its path alongside the error to tell them where it is.
  ipcMain.handle('recorder:stop', async () => {
    const audioPath = recorder.getAudioPath();
    try {
      await recorder.stopRecording();
      const writeError = recorder.getWriteError();
      return writeError ? { audioPath, writeError } : { audioPath };
    } catch (err) {
      log.error('Error stopping recording:', err);
      return {
        audioPath,
        writeError: recorder.getWriteError() ?? (err instanceof Error ? err.message : String(err)),
      };
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
