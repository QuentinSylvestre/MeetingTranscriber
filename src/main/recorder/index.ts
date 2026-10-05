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
 *
 * Worker supervision: the encoder worker is listened to for its whole life ('message',
 * 'error', 'exit'), not only while stopping. A session therefore never reports
 * 'recording' on top of a dead or unwritable encoder: start waits for the worker's
 * 'started' acknowledgement, a write failure mid-session is surfaced to the renderer
 * through recorder:progress, and stop always settles (flushed, error, or timeout).
 */

import { BrowserWindow, dialog, powerSaveBlocker } from 'electron';
import { Worker } from 'worker_threads';
import * as path from 'path';
import * as fs from 'fs';
import { fileURLToPath } from 'url';
import log from 'electron-log';
import { loopbackAvailable } from './loopback';
import { getPreference } from '../settings/store';
import { writeRecordingMarker, clearRecordingMarker } from './recovery';
import { msg } from '../messages';

// __dirname is not available in ESM; derive from import.meta.url.
// vite-plugin-electron compiles main to CJS, so __dirname is available at runtime,
// but we guard with a fallback for correctness in both environments.
const _dirname: string =
  typeof __dirname !== 'undefined'
    ? __dirname
    : path.dirname(fileURLToPath(import.meta.url));

export { loopbackAvailable };

type RecorderStatus = 'idle' | 'starting' | 'recording' | 'paused' | 'stopping';

/** How long the encoder gets to open the output file before start gives up. */
const START_TIMEOUT_MS = 10_000;
/**
 * How long the encoder gets to drain and close the file. A 4-hour recording is ~230 MB;
 * the 5 s this used to be passed on a quiet disk (measured: flush in a few ms) but is
 * the wrong bound for a slow or busy one, where a timeout also abandons the file's tail.
 */
const FLUSH_TIMEOUT_MS = 30_000;

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
  /** First write failure the encoder reported; kept until the next session starts. */
  writeError: string | null;
  powerBlockerId: number | null;
  stopPromise: Promise<void> | null;
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
  writeError: null,
  powerBlockerId: null,
  stopPromise: null,
};

interface Waiter {
  resolve: () => void;
  reject: (err: Error) => void;
}
let startWaiter: Waiter | null = null;
let stopWaiter: Waiter | null = null;

function pushProgress(): void {
  const win = BrowserWindow.getAllWindows()[0];
  if (!win || win.isDestroyed()) return;
  win.webContents.send('recorder:progress', {
    durationMs: getRecordingDurationMs(),
    status: state.status,
    ...(state.writeError ? { writeError: state.writeError } : {}),
  });
}

/** Messages from the encoder worker, for the whole life of a session. */
function onWorkerMessage(msg: { type: string; error?: string }): void {
  switch (msg.type) {
    case 'started':
      startWaiter?.resolve();
      break;
    case 'flushed':
      stopWaiter?.resolve();
      break;
    case 'error':
      onWorkerFailure(msg.error ?? 'Unknown encoder error');
      break;
    default:
      break;
  }
}

/** A worker error, an unexpected exit, or an {type:'error'} message: one path for all three. */
function onWorkerFailure(message: string): void {
  log.error('Encoder failure:', message);
  if (startWaiter) { startWaiter.reject(new Error(message)); return; }
  if (stopWaiter) { stopWaiter.reject(new Error(message)); return; }
  if (state.status === 'recording' || state.status === 'paused') {
    if (state.writeError === null) state.writeError = message;
    pushProgress(); // tell the renderer now rather than on the next tick
  }
}

/** Tears a session down. Safe to call from any state, and more than once. */
function resetSession(): void {
  if (state.progressTimer) {
    clearInterval(state.progressTimer);
    state.progressTimer = null;
  }
  if (state.powerBlockerId !== null) {
    try {
      if (powerSaveBlocker.isStarted(state.powerBlockerId)) powerSaveBlocker.stop(state.powerBlockerId);
    } catch (err) {
      log.warn('Could not release the power-save blocker:', err);
    }
    state.powerBlockerId = null;
  }
  const worker = state.encoderWorker;
  state.encoderWorker = null; // before terminate(): the 'exit' listener ignores stale workers
  worker?.terminate().catch(() => {});
  startWaiter = null;
  stopWaiter = null;
  state.stopPromise = null;
  state.status = 'idle';
}

/** Settles (never rejects) when the start in flight has finished, one way or the other. */
let startInFlight: Promise<void> = Promise.resolve();

/**
 * Resolves once any start in progress has finished. Callers that must act on a recorder
 * that is still starting (a window closed in the first moments) wait on this first, so
 * they see 'recording' or 'idle', never the half-built state in between.
 */
export function waitForStart(): Promise<void> {
  return startInFlight;
}

/**
 * Start a new recording session.
 * Creates the encoder Worker, waits until it has opened the output file, and begins
 * progress push. Rejects (leaving the recorder idle) if the file cannot be opened.
 */
export function startRecording(jobId: string, audioPath: string): Promise<void> {
  const run = beginRecording(jobId, audioPath);
  startInFlight = run.then(() => {}, () => {});
  return run;
}

async function beginRecording(jobId: string, audioPath: string): Promise<void> {
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

  // The folder must exist and be writable. This used to share a catch-all with the
  // disk-space probe below, so an unreachable folder was logged and recording carried on
  // against an encoder that could never open its file.
  const dir = path.dirname(audioPath);
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    throw new Error(msg('folder_unusable', { dir, reason }));
  }

  // Disk space check: warn if < 500 MB available (Node 22 fs.statfs).
  try {
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
    // statfs not available on this platform/Node version.
    log.warn('Disk space check skipped:', err);
  }

  // Resolve the compiled encoder path. In dev (ts-node or vite), the file is
  // encoder.ts; in production it is encoder.js after bundling.
  // vite-plugin-electron bundles to dist-electron/, so we look for encoder.js
  // alongside this compiled file.
  const workerPath = path.join(_dirname, 'encoder.js');

  state.status = 'starting';
  state.writeError = null;
  const worker = new Worker(workerPath);
  state.encoderWorker = worker;
  worker.on('message', (msg: { type: string; error?: string }) => {
    if (worker === state.encoderWorker) onWorkerMessage(msg);
  });
  worker.on('error', (err: Error) => {
    if (worker === state.encoderWorker) onWorkerFailure(err.message);
  });
  worker.on('exit', (code) => {
    if (worker === state.encoderWorker) onWorkerFailure(`Encoder stopped unexpectedly (exit code ${code})`);
  });

  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`Encoder did not start within ${START_TIMEOUT_MS / 1000} seconds`)),
        START_TIMEOUT_MS,
      );
      startWaiter = {
        resolve: () => { clearTimeout(timer); resolve(); },
        reject: (err: Error) => { clearTimeout(timer); reject(err); },
      };
      worker.postMessage({
        type: 'start',
        data: { outputPath: audioPath, sampleRate: 44100 },
      });
    });
  } catch (err) {
    resetSession();
    clearRecordingMarker(audioPath);
    throw err;
  }
  startWaiter = null;

  state.status = 'recording';
  state.jobId = jobId;
  state.audioPath = audioPath;
  state.startTime = Date.now();
  state.pausedMs = 0;
  state.pauseStartTime = null;

  writeRecordingMarker(audioPath);

  // A meeting is hours long and the screen is often idle for all of it. Without this,
  // the machine may sleep and capture stops with nothing to say so afterwards.
  try {
    state.powerBlockerId = powerSaveBlocker.start('prevent-app-suspension');
  } catch (err) {
    log.warn('Could not start the power-save blocker:', err);
  }

  // Push progress to the renderer every second.
  state.progressTimer = setInterval(() => {
    const win = BrowserWindow.getAllWindows()[0];
    if (!win || win.isDestroyed()) {
      clearInterval(state.progressTimer!);
      state.progressTimer = null;
      return;
    }
    pushProgress();
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
 * Always settles: rejects on an encoder error, an unexpected encoder exit, or after
 * FLUSH_TIMEOUT_MS. A second call while one is in flight returns the same promise.
 * The recorder is idle again once this settles, whichever way it settles.
 */
export function stopRecording(): Promise<void> {
  if (state.status === 'idle') return Promise.resolve();
  if (state.stopPromise) return state.stopPromise;
  // A stop that arrives during start waits for it, then stops what came out of it (or
  // finds nothing to stop if the start failed). Stopping a half-started session would
  // leave its encoder running with nothing holding a reference to it.
  if (state.status === 'starting') return startInFlight.then(() => stopRecording());

  state.status = 'stopping';
  if (state.progressTimer) {
    clearInterval(state.progressTimer);
    state.progressTimer = null;
  }

  const audioPath = state.audioPath;
  const worker = state.encoderWorker;
  state.stopPromise = new Promise<void>((resolve, reject) => {
    if (!worker) {
      resetSession();
      resolve();
      return;
    }
    const timeout = setTimeout(() => {
      log.error(`Encoder Worker flush timed out after ${FLUSH_TIMEOUT_MS / 1000} seconds`);
      resetSession();
      reject(new Error(`Encoder flush timed out after ${FLUSH_TIMEOUT_MS / 1000} seconds`));
    }, FLUSH_TIMEOUT_MS);

    stopWaiter = {
      resolve: () => {
        clearTimeout(timeout);
        const failed = state.writeError !== null;
        resetSession();
        // Keep the marker after a write failure: the file may be partial and the next
        // launch should still offer it.
        if (!failed && audioPath) clearRecordingMarker(audioPath);
        log.info('Recording stopped and flushed');
        resolve();
      },
      reject: (err) => {
        clearTimeout(timeout);
        if (state.writeError === null) state.writeError = err.message;
        resetSession();
        log.error('Encoder failed during flush:', err.message);
        reject(err);
      },
    };
    worker.postMessage({ type: 'flush' });
  });
  return state.stopPromise;
}

/**
 * Current recording duration in milliseconds, excluding paused time.
 * Returns 0 if not recording.
 */
export function getRecordingDurationMs(): number {
  if (state.status === 'idle' || state.status === 'starting') return 0;
  const elapsed = Date.now() - state.startTime;
  const paused = state.pauseStartTime !== null
    ? state.pausedMs + (Date.now() - state.pauseStartTime)
    : state.pausedMs;
  return Math.max(0, elapsed - paused);
}

export function getStatus(): RecorderStatus {
  return state.status;
}

/** Returns the audio file path for the current or most-recent recording session. */
export function getAudioPath(): string | null {
  return state.audioPath;
}

/** First write failure of the current or most-recent session, if any. */
export function getWriteError(): string | null {
  return state.writeError;
}
