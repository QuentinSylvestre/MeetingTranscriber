/**
 * useRecorder.ts — React hook for managing the recording session.
 *
 * Coordinates:
 *   1. AudioContext + AudioWorkletNode (mic capture in browser audio thread)
 *   2. IPC bridge to main process (recorder:start/pause/resume/stop/pcm-chunk)
 *   3. Push event subscription (recorder:progress from main process)
 *
 * Architecture: IPC-batched PCM (Phase 4 divergence from plan's SAB approach).
 * The AudioWorklet posts batches of ~50 ms PCM to this hook via workletNode.port,
 * which forwards them to the main process via ipcRenderer.invoke('recorder:pcm-chunk').
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import type { RecorderProgress } from '../../shared/ipc-types';
// `?worker&url` makes Vite compile the worklet to a standalone JS bundle and hand back
// its URL. The obvious `new URL('../worklets/mic-capture.worklet.ts', import.meta.url)`
// is wrong here: Vite classifies that as a static asset, so a production build copies
// the TypeScript source verbatim — under the 4 KB inline limit it became a
// `data:video/mp2t;base64,` URI holding raw TS — and addModule() got something no JS
// engine can parse. The dev server transpiles on request, so this only ever broke the
// packaged app.
import micCaptureWorkletUrl from '../worklets/mic-capture.worklet.ts?worker&url';

// The Window shape is declared once, in src/renderer/global.d.ts.

export type RecordingStatus = 'idle' | 'recording' | 'paused' | 'stopping';

/**
 * Why starting failed, as a code the view turns into a translated sentence. The raw
 * DOMException message is English and phrased for developers ("Requested device not
 * found"), which is not what belongs in a French UI.
 */
export type RecorderErrorCode =
  | 'mic_not_found'
  | 'mic_denied'
  | 'mic_busy'
  | 'audio_engine'
  | 'unknown';

/** Carries the code out of start() while keeping the original error for the console. */
class RecorderStartError extends Error {
  // Named `inner` rather than `cause` so it does not shadow the built-in Error.cause.
  constructor(readonly code: RecorderErrorCode, readonly inner: unknown) {
    super(`recorder start failed: ${code}`);
  }
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

/** Map a getUserMedia rejection to a code. Names are from the MediaDevices spec. */
function classifyMicError(err: unknown): RecorderErrorCode {
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

/**
 * @param onStopped — called with the jobId when recording has been fully stopped
 *                    and the MP3 flushed to disk.
 */
export function useRecorder(onStopped: (jobId: string) => void): {
  status: RecordingStatus;
  durationMs: number;
  error: RecorderErrorCode | null;
  /** Loudest sample seen in the last refresh window, 0..1. Drives the input meter. */
  inputLevel: number;
  /** True once the input has been effectively silent for SILENCE_WARN_MS. */
  inputSilent: boolean;
  start: (jobId: string, micDeviceId?: string) => Promise<void>;
  pause: () => Promise<void>;
  resume: () => Promise<void>;
  stop: () => Promise<{ audioPath: string | null }>;
} {
  const [status, setStatus] = useState<RecordingStatus>('idle');
  const [durationMs, setDurationMs] = useState(0);
  const [error, setError] = useState<RecorderErrorCode | null>(null);
  const [inputLevel, setInputLevel] = useState(0);
  const [inputSilent, setInputSilent] = useState(false);

  // Peak is written 20x/s from the audio callback but read 10x/s by the meter, so it
  // lives in a ref: putting it in state would re-render on every batch.
  const peakRef = useRef(0);
  const silentMsRef = useRef(0);

  const jobIdRef = useRef<string | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const workletNodeRef = useRef<AudioWorkletNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  // Track whether we are currently paused so we can gate PCM forwarding.
  const isPausedRef = useRef(false);

  // Subscribe to progress push events from the main process.
  useEffect(() => {
    const handler = (...args: unknown[]) => {
      const p = args[0] as RecorderProgress;
      setDurationMs(p.durationMs);
      // Sync status from main process (source of truth for duration accounting).
      if (p.status === 'stopped') {
        setStatus('idle');
      } else {
        setStatus(p.status as RecordingStatus);
      }
    };
    window.electronAPI.on('recorder:progress', handler);
    return () => {
      window.electronAPI.off('recorder:progress', handler);
    };
  }, []);

  // Drain the peak into state on a fixed cadence. Resetting it each tick is what makes
  // the meter fall back to zero when the input goes quiet, instead of holding the
  // loudest sample of the whole session.
  useEffect(() => {
    if (status !== 'recording') {
      setInputLevel(0);
      return;
    }
    const timer = setInterval(() => {
      setInputLevel(peakRef.current);
      peakRef.current = 0;
    }, LEVEL_REFRESH_MS);
    return () => clearInterval(timer);
  }, [status]);

  const start = useCallback(async (
    jobId: string,
    micDeviceId?: string
  ): Promise<void> => {
    setError(null);
    setInputSilent(false);
    peakRef.current = 0;
    silentMsRef.current = 0;
    try {
      // --- 1. Set up AudioContext + AudioWorklet ---
      const ctx = new AudioContext({ sampleRate: 44100 });
      audioContextRef.current = ctx;

      // Load the AudioWorklet module. Vite emits it as its own compiled bundle; see the
      // note on the micCaptureWorkletUrl import for why it is not referenced by path.
      // Attributed separately from the microphone below: a failure here is a packaging
      // fault in the application, not something the user can act on.
      try {
        await ctx.audioWorklet.addModule(micCaptureWorkletUrl);
      } catch (err) {
        throw new RecorderStartError('audio_engine', err);
      }

      // --- 2. Acquire microphone stream ---
      const constraints: MediaStreamConstraints = {
        audio: micDeviceId
          ? { deviceId: { exact: micDeviceId }, sampleRate: 44100, channelCount: 1 }
          : { sampleRate: 44100, channelCount: 1 },
      };
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia(constraints);
      } catch (err) {
        throw new RecorderStartError(classifyMicError(err), err);
      }
      streamRef.current = stream;

      const source = ctx.createMediaStreamSource(stream);

      // --- 3. Create AudioWorkletNode and wire PCM forwarding ---
      const workletNode = new AudioWorkletNode(ctx, 'mic-capture');
      workletNodeRef.current = workletNode;

      workletNode.port.onmessage = (
        event: MessageEvent<{ type: string; data: Int16Array; peak?: number }>
      ) => {
        if (event.data.type === 'pcm' && !isPausedRef.current) {
          // Level and silence are measured from batches actually being recorded, so a
          // pause freezes both rather than counting the quiet as dead input.
          const peak = event.data.peak ?? 0;
          if (peak > peakRef.current) peakRef.current = peak;
          if (peak < SILENT_PEAK) {
            silentMsRef.current += (event.data.data.length / 44100) * 1000;
            if (silentMsRef.current >= SILENCE_WARN_MS) setInputSilent(true);
          } else {
            silentMsRef.current = 0;
            setInputSilent(false);
          }

          // Forward PCM batch to main process.
          // Convert Int16Array to plain number[] for IPC serialisation.
          window.electronAPI.invoke('recorder:pcm-chunk', {
            chunk: Array.from(event.data.data),
          }).catch((err) => {
            // Non-fatal: log and continue — a dropped chunk causes minor audio
            // quality degradation but not a recording failure.
            console.warn('recorder:pcm-chunk invoke failed:', err);
          });
        }
      };

      source.connect(workletNode);
      // Do NOT connect workletNode to destination — we don't want mic monitoring.

      // --- 4. Start recording in main process ---
      await window.electronAPI.invoke('recorder:start', { jobId, micDeviceId, enableLoopback: false });

      jobIdRef.current = jobId;
      isPausedRef.current = false;
      setStatus('recording');
    } catch (err) {
      // Clean up partially initialised audio resources.
      audioContextRef.current?.close().catch(() => {});
      audioContextRef.current = null;
      workletNodeRef.current = null;
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      // Keep the underlying error visible to whoever is debugging; the user gets the
      // translated sentence the code maps to.
      console.error('Recording failed to start:',
        err instanceof RecorderStartError ? err.inner : err);
      setError(err instanceof RecorderStartError ? err.code : 'unknown');
      setStatus('idle');
    }
  }, []);

  const pause = useCallback(async (): Promise<void> => {
    isPausedRef.current = true;
    await window.electronAPI.invoke('recorder:pause');
    setStatus('paused');
  }, []);

  const resume = useCallback(async (): Promise<void> => {
    isPausedRef.current = false;
    await window.electronAPI.invoke('recorder:resume');
    setStatus('recording');
  }, []);

  const stop = useCallback(async (): Promise<{ audioPath: string | null }> => {
    setStatus('stopping');
    isPausedRef.current = false;
    // Deliberately not clearing inputSilent/inputLevel here. The meter effect zeroes the
    // level on the status change, the warning is only rendered while capturing, and
    // start() resets both. Clearing them before awaiting the flush would throw away the
    // silence signal precisely when the flush fails and the view stays on 'stopping'.

    // Stop PCM forwarding by disconnecting and closing the audio graph.
    workletNodeRef.current?.disconnect();
    workletNodeRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    audioContextRef.current?.close().catch(() => {});
    audioContextRef.current = null;

    // Tell main process to flush the encoder and close the file.
    // Main returns { audioPath } so the renderer can pass it to transcription:start-job.
    const result = await window.electronAPI.invoke('recorder:stop') as { audioPath: string | null };

    const jid = jobIdRef.current;
    jobIdRef.current = null;
    setStatus('idle');
    setDurationMs(0);
    if (jid) onStopped(jid);
    return { audioPath: result?.audioPath ?? null };
  }, [onStopped]);

  return { status, durationMs, error, inputLevel, inputSilent, start, pause, resume, stop };
}
