/**
 * recorder/index.ts — Recording orchestrator (main process).
 *
 * Architecture note (Phase 4 divergence from plan):
 * The plan specified a SharedArrayBuffer ring buffer for zero-IPC PCM forwarding
 * from renderer → main. However, SABs allocated in the renderer cannot be
 * transferred to the main process via IPC (serialization drops the shared memory
 * reference), and SABs allocated in the main process cannot be transferred to the
 * renderer without a dedicated MessageChannel + postMessage with transferables.
 *
 * Phase 4 uses IPC-batched PCM instead: the AudioWorklet collects ~50 ms of PCM
 * samples and posts them to the renderer thread, which calls
 * ipcRenderer.invoke('recorder:pcm-chunk', { chunk }) once per batch. This adds
 * one IPC round-trip per 50 ms (20 calls/s) — acceptable overhead vs. per-frame
 * IPC (4410 calls/s at 44100 Hz). See Phase 4 implementation notes in the plan.
 */

import { BrowserWindow, dialog } from 'electron';
import { Worker } from 'worker_threads';
import * as path from 'path';
import * as fs from 'fs';
import { fileURLToPath } from 'url';
import log from 'electron-log';
import { loopbackAvailable } from './loopback';
import { getPreference } from '../settings/store';

// __dirname is not available in ESM; derive from import.meta.url.
// vite-plugin-electron compiles main to CJS, so __dirname is available at runtime,
// but we guard with a fallback for correctness in both environments.
const _dirname: string =
  typeof __dirname !== 'undefined'
    ? __dirname
    : path.dirname(fileURLToPath(import.meta.url));

export { loopbackAvailable };

type RecorderStatus = 'idle' | 'recording' | 'paused' | 'stopping';

interface RecorderState {
  status: RecorderStatus;
  jobId: string | null;
  audioPath: string | null;
  encoderWorker: Worker | null;
  progressTimer: ReturnType<typeof setInterval> | null;
  startTime: number;
  /** Accumulated paused duration in ms (closed intervals). */
  pausedMs: number;
  /** Timestamp when the current pause began (null if not paused). */
  pauseStartTime: number | null;
}

const state: RecorderState = {
  status: 'idle',
  jobId: null,
  audioPath: null,
  encoderWorker: null,
  progressTimer: null,
  startTime: 0,
  pausedMs: 0,
  pauseStartTime: null,
};

/**
 * Start a new recording session.
 * Creates the encoder Worker, opens the output file, and begins progress push.
 */
export function startRecording(jobId: string, audioPath: string): void {
  if (state.status !== 'idle') {
    throw new Error(`Recorder already active (status: ${state.status})`);
  }

  // F2: Confine audioPath to the recordings folder to prevent path traversal.
  const recordingsFolder = getPreference('recordingsFolder');
  const resolvedAudioPath = path.resolve(audioPath);
  const resolvedRecordingsFolder = path.resolve(recordingsFolder);
  if (!resolvedAudioPath.startsWith(resolvedRecordingsFolder + path.sep)) {
    throw new Error(`audioPath must be inside the recordings folder: ${recordingsFolder}`);
  }

  // Disk space check: warn if < 500 MB available (Node 22 fs.statfs).
  const dir = path.dirname(audioPath);
  try {
    fs.mkdirSync(dir, { recursive: true });
    const fsExt = fs as unknown as {
      statfsSync?: (p: string) => { bavail: number; bsize: number };
    };
    const stats = fsExt.statfsSync?.(dir);
    if (stats) {
      const availableBytes = stats.bavail * stats.bsize;
      const availableMb = Math.round(availableBytes / (1024 * 1024));
      if (availableBytes < 500 * 1024 * 1024) {
        log.warn(`Low disk space: ${availableMb} MB available in ${dir}`);
        // Show a non-blocking warning dialog.
        const win = BrowserWindow.getAllWindows()[0];
        if (win && !win.isDestroyed()) {
          dialog.showMessageBox(win, {
            type: 'warning',
            title: 'Low Disk Space',
            message: `Only ${availableMb} MB of disk space available.`,
            detail: 'Recording may fail if space runs out. Consider freeing space or changing the recordings folder in Settings.',
            buttons: ['OK'],
          });
          // Do NOT await — don't block recording start.
        }
      }
    }
  } catch (err) {
    // statfs not available on this platform/Node version, or mkdirSync failed.
    log.warn('Disk space check skipped:', err);
  }

  // Resolve the compiled encoder path. In dev (ts-node or vite), the file is
  // encoder.ts; in production it is encoder.js after bundling.
  // vite-plugin-electron bundles to dist-electron/, so we look for encoder.js
  // alongside this compiled file.
  const workerPath = path.join(_dirname, 'encoder.js');

  state.encoderWorker = new Worker(workerPath);
  state.encoderWorker.postMessage({
    type: 'start',
    data: { outputPath: audioPath, sampleRate: 44100 },
  });
  state.encoderWorker.on('error', (err) => {
    log.error('Encoder Worker error:', err);
  });

  state.status = 'recording';
  state.jobId = jobId;
  state.audioPath = audioPath;
  state.startTime = Date.now();
  state.pausedMs = 0;
  state.pauseStartTime = null;

  // Push progress to the renderer every second.
  state.progressTimer = setInterval(() => {
    const win = BrowserWindow.getAllWindows()[0];
    if (!win || win.isDestroyed()) {
      clearInterval(state.progressTimer!);
      state.progressTimer = null;
      return;
    }
    win.webContents.send('recorder:progress', {
      durationMs: getRecordingDurationMs(),
      status: state.status,
    });
    if (state.status === 'idle') {
      clearInterval(state.progressTimer!);
      state.progressTimer = null;
    }
  }, 1000);

  log.info(`Recording started: job=${jobId}, path=${audioPath}`);
}

/**
 * Forward a batch of Int16 PCM samples to the encoder Worker.
 * Called by the recorder:pcm-chunk IPC handler.
 */
export function receivePcmChunk(chunk: Int16Array): void {
  if ((state.status !== 'recording' && state.status !== 'stopping') || !state.encoderWorker) return;
  state.encoderWorker.postMessage({ type: 'pcm', data: chunk });
}

export function pauseRecording(): void {
  if (state.status !== 'recording') return;
  state.status = 'paused';
  state.pauseStartTime = Date.now();
  state.encoderWorker?.postMessage({ type: 'pause' });
  log.info('Recording paused');
}

export function resumeRecording(): void {
  if (state.status !== 'paused') return;
  if (state.pauseStartTime !== null) {
    state.pausedMs += Date.now() - state.pauseStartTime;
    state.pauseStartTime = null;
  }
  state.status = 'recording';
  state.encoderWorker?.postMessage({ type: 'resume' });
  log.info('Recording resumed');
}

/**
 * Stop recording, flush the MP3 stream, and clean up resources.
 * Resolves when the encoder has finished writing and closed the file.
 * Rejects after a 5-second timeout if the encoder does not respond.
 */
export function stopRecording(): Promise<void> {
  if (state.status === 'idle') return Promise.resolve();

  state.status = 'stopping';

  // Stop the progress push timer.
  if (state.progressTimer) {
    clearInterval(state.progressTimer);
    state.progressTimer = null;
  }

  return new Promise((resolve, reject) => {
    if (!state.encoderWorker) {
      state.status = 'idle';
      resolve();
      return;
    }

    const timeout = setTimeout(() => {
      log.error('Encoder Worker flush timed out after 5 seconds');
      state.encoderWorker?.terminate().catch(() => {});
      state.encoderWorker = null;
      state.status = 'idle';
      reject(new Error('Encoder flush timed out after 5 seconds'));
    }, 5000);

    state.encoderWorker.once('message', (msg: { type: string; error?: string }) => {
      clearTimeout(timeout);
      state.encoderWorker?.terminate().catch(() => {});
      state.encoderWorker = null;
      state.status = 'idle';
      if (msg.type === 'flushed') {
        log.info('Recording stopped and flushed');
        resolve();
      } else {
        // Received an error or unexpected message before flushed.
        const errMsg = msg.error ?? `Unexpected encoder message: ${msg.type}`;
        log.error('Encoder failed during flush:', errMsg);
        reject(new Error(errMsg));
      }
    });

    state.encoderWorker.postMessage({ type: 'flush' });
  });
}

/**
 * Current recording duration in milliseconds, excluding paused time.
 * Returns 0 if not recording.
 */
export function getRecordingDurationMs(): number {
  if (state.status === 'idle') return 0;
  const elapsed = Date.now() - state.startTime;
  const paused = state.pauseStartTime !== null
    ? state.pausedMs + (Date.now() - state.pauseStartTime)
    : state.pausedMs;
  return Math.max(0, elapsed - paused);
}

export function getStatus(): RecorderStatus {
  return state.status;
}
