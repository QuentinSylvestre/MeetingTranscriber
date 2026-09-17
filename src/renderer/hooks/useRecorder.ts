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

// The Window shape is declared once, in src/renderer/global.d.ts.

export type RecordingStatus = 'idle' | 'recording' | 'paused' | 'stopping';

/**
 * @param onStopped — called with the jobId when recording has been fully stopped
 *                    and the MP3 flushed to disk.
 */
export function useRecorder(onStopped: (jobId: string) => void): {
  status: RecordingStatus;
  durationMs: number;
  error: string | null;
  start: (jobId: string, micDeviceId?: string) => Promise<void>;
  pause: () => Promise<void>;
  resume: () => Promise<void>;
  stop: () => Promise<{ audioPath: string | null }>;
} {
  const [status, setStatus] = useState<RecordingStatus>('idle');
  const [durationMs, setDurationMs] = useState(0);
  const [error, setError] = useState<string | null>(null);

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

  const start = useCallback(async (
    jobId: string,
    micDeviceId?: string
  ): Promise<void> => {
    setError(null);
    try {
      // --- 1. Set up AudioContext + AudioWorklet ---
      const ctx = new AudioContext({ sampleRate: 44100 });
      audioContextRef.current = ctx;

      // Load the AudioWorklet module. In dev (Vite), the file is served from
      // the dev server at /src/renderer/worklets/mic-capture.worklet.ts.
      // In production, Vite bundles it to dist/ and the URL is the same relative path.
      await ctx.audioWorklet.addModule(
        new URL('../worklets/mic-capture.worklet.ts', import.meta.url).href
      );

      // --- 2. Acquire microphone stream ---
      const constraints: MediaStreamConstraints = {
        audio: micDeviceId
          ? { deviceId: { exact: micDeviceId }, sampleRate: 44100, channelCount: 1 }
          : { sampleRate: 44100, channelCount: 1 },
      };
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      streamRef.current = stream;

      const source = ctx.createMediaStreamSource(stream);

      // --- 3. Create AudioWorkletNode and wire PCM forwarding ---
      const workletNode = new AudioWorkletNode(ctx, 'mic-capture');
      workletNodeRef.current = workletNode;

      workletNode.port.onmessage = (event: MessageEvent<{ type: string; data: Int16Array }>) => {
        if (event.data.type === 'pcm' && !isPausedRef.current) {
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
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
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

  return { status, durationMs, error, start, pause, resume, stop };
}
