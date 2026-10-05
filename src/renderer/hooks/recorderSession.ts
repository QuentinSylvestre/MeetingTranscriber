/**
 * recorderSession.ts — the recording session, held outside React.
 *
 * Everything that has to outlive a view lives here: the audio graph, the pause state, the
 * job id and the job settings chosen at Start. It used to live in refs and state inside a
 * hook mounted by the Record view, and App renders only the current view, so leaving
 * Record mid-recording destroyed it while the main process kept recording. What survived
 * was a microphone and a worklet nobody could reach: a Resume after returning left the old
 * graph's pause flag set (the file stopped growing while the timer ran), Stop found no job
 * id to transcribe, and the microphone stayed open after Stop.
 *
 * One session per window, created once (see useRecorder.ts). The factory takes its browser
 * and IPC dependencies as parameters so the logic can be tested without a DOM.
 */

import type { RecorderProgress, SpeakerCountHint, ProviderName } from '../../shared/ipc-types';

export type RecordingStatus = 'idle' | 'starting' | 'recording' | 'paused' | 'stopping';

/**
 * Why something failed, as a code the view turns into a translated sentence. Raw
 * DOMException and IPC messages are English and phrased for developers; `detail` carries
 * them through for the causes where the specifics (a path, an OS error) help the user.
 */
export type RecorderErrorCode =
  | 'mic_not_found'
  | 'mic_denied'
  | 'mic_busy'
  | 'audio_engine'
  | 'start_failed'
  | 'stop_failed'
  | 'write_failed'
  | 'control_failed'
  | 'unknown';

export interface RecorderError {
  code: RecorderErrorCode;
  detail?: string;
  /** Where the audio recorded so far is, for write_failed and stop_failed. */
  path?: string;
}

/** What to transcribe with, fixed when recording starts so a later Settings change cannot alter it. */
export interface RecordingJobConfig {
  provider: ProviderName;
  language: 'fr' | 'en' | 'auto';
  speakerCountHint?: SpeakerCountHint;
}

export interface RecorderSnapshot {
  status: RecordingStatus;
  durationMs: number;
  error: RecorderError | null;
  /** Loudest sample seen in the last refresh window, 0..1. Drives the input meter. */
  inputLevel: number;
  /** True once the input has been effectively silent for SILENCE_WARN_MS. */
  inputSilent: boolean;
  /** True once the microphone track has ended (device unplugged or revoked). */
  inputLost: boolean;
  jobId: string | null;
}

export interface StopResult {
  jobId: string | null;
  audioPath: string | null;
  config: RecordingJobConfig | null;
  /** When set, no job should be started: the audio may be partial or missing. */
  error?: RecorderError;
}

/** Carries the code out of an open attempt while keeping the original error for the console. */
export class RecorderStartError extends Error {
  // Named `inner` rather than `cause` so it does not shadow the built-in Error.cause.
  constructor(readonly code: RecorderErrorCode, readonly inner: unknown) {
    super(`recorder start failed: ${code}`);
  }
}

/** Map a getUserMedia rejection to a code. Names are from the MediaDevices spec. */
export function classifyMicError(err: unknown): RecorderErrorCode {
  const name = err instanceof Error ? err.name : '';
  switch (name) {
    case 'NotFoundError':
    // The requested device exists but no longer satisfies the constraints — from the
    // user's side this is indistinguishable from it being gone.
    case 'OverconstrainedError':
      return 'mic_not_found';
    case 'NotAllowedError':
    case 'SecurityError':
      return 'mic_denied';
    case 'NotReadableError':
    case 'AbortError':
      return 'mic_busy';
    default:
      return 'unknown';
  }
}

export interface CaptureGraph {
  /** Stops the tracks, disconnects the worklet and closes the audio context. */
  close(): void;
}

export interface RecorderDeps {
  api: {
    invoke(channel: string, ...args: unknown[]): Promise<unknown>;
    on(channel: string, listener: (...args: unknown[]) => void): void;
    off(channel: string, listener: (...args: unknown[]) => void): void;
  };
  /**
   * Opens the microphone and starts delivering ~50 ms PCM batches. Rejects with a
   * RecorderStartError when the audio engine or the microphone cannot be opened.
   * `onInputEnded` fires if the microphone track ends by itself.
   */
  openCapture(
    micDeviceId: string | undefined,
    onBatch: (pcm: Int16Array, peak: number) => void,
    onInputEnded: () => void,
  ): Promise<CaptureGraph>;
}

/**
 * Peak below which a batch counts as no signal at all, and how long that has to hold
 * before the view says so. 0.001 is about -60 dBFS: a live microphone in a silent room
 * still sits above its own noise floor, so this only fires on input that is genuinely
 * dead — a track muted by the OS, or a Bluetooth headset connected for output only.
 * Erring low matters more than erring early: a meeting recorded in good faith against a
 * dead input is unrecoverable, but a warning that cries wolf gets ignored.
 */
const SILENT_PEAK = 0.001;
/**
 * Fifteen seconds, not five. The warning has to survive an ordinary pause in a quiet
 * room: a council meeting goes five seconds without speech constantly, and Chromium's
 * default noise suppression pushes a quiet room's floor down toward zero, so short
 * windows produce a warning that flickers and then gets ignored. A genuinely dead input
 * stays dead for the whole session, so waiting is free — you still learn inside the
 * first minute. Untested against a real quiet room: no machine here has a microphone.
 */
const SILENCE_WARN_MS = 15000;
/** Meter refresh. Batches arrive at 20/s; redrawing at 10/s is smooth and half the work. */
const LEVEL_REFRESH_MS = 100;
const SAMPLE_RATE = 44100;

export function formatDuration(ms: number): string {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

/** "Error invoking remote method 'x': Error: reason" -> "reason". */
function ipcReason(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  return raw.replace(/^Error invoking remote method '[^']*': (Error: )?/, '');
}

const INITIAL: RecorderSnapshot = {
  status: 'idle',
  durationMs: 0,
  error: null,
  inputLevel: 0,
  inputSilent: false,
  inputLost: false,
  jobId: null,
};

export interface RecorderSession {
  subscribe(listener: () => void): () => void;
  getSnapshot(): RecorderSnapshot;
  start(jobId: string, micDeviceId: string | undefined, config: RecordingJobConfig): Promise<void>;
  pause(): Promise<void>;
  resume(): Promise<void>;
  /** Returns null when nothing is being recorded. Always leaves the session idle. */
  stop(): Promise<StopResult | null>;
}

export function createRecorderSession(deps: RecorderDeps): RecorderSession {
  const { api } = deps;
  let snap: RecorderSnapshot = INITIAL;
  const listeners = new Set<() => void>();

  let graph: CaptureGraph | null = null;
  let config: RecordingJobConfig | null = null;
  // Peak is written 20x/s from the audio callback but read 10x/s by the meter, so it is
  // kept outside the snapshot: publishing it per batch would re-render on every batch.
  let peak = 0;
  let silentMs = 0;
  let levelTimer: ReturnType<typeof setInterval> | null = null;

  /** Publishes a change. The snapshot object only changes when a field does. */
  function set(patch: Partial<RecorderSnapshot>): void {
    const next = { ...snap, ...patch };
    const changed = (Object.keys(next) as (keyof RecorderSnapshot)[]).some(k => next[k] !== snap[k]);
    if (!changed) return;
    snap = next;
    for (const l of [...listeners]) l();
  }

  // Drain the peak into the snapshot on a fixed cadence. Resetting it each tick is what
  // makes the meter fall back to zero when the input goes quiet, instead of holding the
  // loudest sample of the whole session.
  function syncLevelTimer(): void {
    if (snap.status === 'recording') {
      if (!levelTimer) {
        levelTimer = setInterval(() => {
          set({ inputLevel: peak });
          peak = 0;
        }, LEVEL_REFRESH_MS);
      }
    } else if (levelTimer) {
      clearInterval(levelTimer);
      levelTimer = null;
      peak = 0;
      set({ inputLevel: 0 });
    }
  }

  function onBatch(pcm: Int16Array, batchPeak: number): void {
    // The session's own status is the gate, so there is no second flag to fall out of step
    // with it. Level and silence are measured only from batches actually being recorded:
    // a pause freezes both rather than counting the quiet as dead input.
    if (snap.status !== 'recording') return;
    if (batchPeak > peak) peak = batchPeak;
    if (batchPeak < SILENT_PEAK) {
      silentMs += (pcm.length / SAMPLE_RATE) * 1000;
      if (silentMs >= SILENCE_WARN_MS) set({ inputSilent: true });
    } else {
      silentMs = 0;
      set({ inputSilent: false });
    }
    // Convert Int16Array to plain number[] for IPC serialisation.
    api.invoke('recorder:pcm-chunk', { chunk: Array.from(pcm) }).catch((err) => {
      // Non-fatal: a dropped chunk causes minor audio quality degradation, not a failed
      // recording. A persistent failure shows up as the encoder's own error.
      console.warn('recorder:pcm-chunk invoke failed:', err);
    });
  }

  const onProgress = (...args: unknown[]): void => {
    const p = args[0] as RecorderProgress;
    if (snap.status !== 'recording' && snap.status !== 'paused') return;
    // Main owns the duration (it excludes paused time). A write failure it reports means
    // the file is no longer being written even though capture carries on.
    set({
      durationMs: p.durationMs,
      error: p.writeError && snap.error?.code !== 'write_failed'
        ? { code: 'write_failed', detail: p.writeError }
        : snap.error,
    });
  };

  async function start(jobId: string, micDeviceId: string | undefined, jobConfig: RecordingJobConfig): Promise<void> {
    if (snap.status !== 'idle') return;
    peak = 0;
    silentMs = 0;
    config = jobConfig;
    set({
      status: 'starting', error: null, inputSilent: false, inputLost: false,
      inputLevel: 0, durationMs: 0, jobId,
    });
    try {
      graph = await deps.openCapture(micDeviceId, onBatch, () => set({ inputLost: true }));
      await api.invoke('recorder:start', { jobId, micDeviceId, enableLoopback: false });
    } catch (err) {
      // Clean up partially initialised audio resources.
      graph?.close();
      graph = null;
      config = null;
      // Keep the underlying error visible to whoever is debugging; the user gets the
      // translated sentence the code maps to.
      console.error('Recording failed to start:', err instanceof RecorderStartError ? err.inner : err);
      const error: RecorderError = err instanceof RecorderStartError
        ? { code: err.code }
        : { code: 'start_failed', detail: ipcReason(err) };
      set({ status: 'idle', error, jobId: null });
      return;
    }
    api.on('recorder:progress', onProgress);
    set({ status: 'recording' });
    syncLevelTimer();
  }

  async function pause(): Promise<void> {
    if (snap.status !== 'recording') return;
    // Local status first: it is what stops PCM being forwarded, so nothing recorded after
    // the click reaches the encoder while the IPC call is in flight.
    set({ status: 'paused' });
    syncLevelTimer();
    try {
      await api.invoke('recorder:pause');
    } catch (err) {
      set({ status: 'recording', error: { code: 'control_failed', detail: ipcReason(err) } });
      syncLevelTimer();
    }
  }

  async function resume(): Promise<void> {
    if (snap.status !== 'paused') return;
    try {
      await api.invoke('recorder:resume');
    } catch (err) {
      set({ error: { code: 'control_failed', detail: ipcReason(err) } });
      return;
    }
    set({ status: 'recording' });
    syncLevelTimer();
  }

  async function stop(): Promise<StopResult | null> {
    if (snap.status !== 'recording' && snap.status !== 'paused') return null;
    const jobId = snap.jobId;
    const jobConfig = config;
    set({ status: 'stopping' });
    syncLevelTimer();

    // Stop PCM forwarding by closing the audio graph. Its microphone and context belong to
    // this session, so they are released here whichever view is showing.
    graph?.close();
    graph = null;
    api.off('recorder:progress', onProgress);

    let result: { audioPath: string | null; writeError?: string };
    try {
      // Main returns { audioPath } so the caller can pass it to transcription:start-job.
      result = await api.invoke('recorder:stop') as { audioPath: string | null; writeError?: string };
    } catch (err) {
      // Whatever happens, the session must end idle: a view left on 'stopping' has no
      // buttons and no way out.
      const error: RecorderError = { code: 'stop_failed', detail: ipcReason(err) };
      config = null;
      set({ status: 'idle', durationMs: 0, jobId: null, inputSilent: false, error });
      return { jobId, audioPath: null, config: jobConfig, error };
    }
    config = null;
    const error: RecorderError | undefined = result?.writeError
      ? { code: 'write_failed', detail: result.writeError, path: result.audioPath ?? undefined }
      : undefined;
    set({ status: 'idle', durationMs: 0, jobId: null, inputSilent: false, error: error ?? null });
    return { jobId, audioPath: result?.audioPath ?? null, config: jobConfig, ...(error ? { error } : {}) };
  }

  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    getSnapshot: () => snap,
    start,
    pause,
    resume,
    stop,
  };
}
