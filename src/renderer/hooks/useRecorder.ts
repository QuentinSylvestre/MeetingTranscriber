/**
 * useRecorder.ts — React binding for the recording session.
 *
 * The session itself (audio graph, pause state, job id, job settings) lives in
 * recorderSession.ts, outside React, so it survives the Record view being unmounted when
 * the user opens another menu. This hook only subscribes a component to it.
 *
 * Architecture: IPC-batched PCM (Phase 4 divergence from plan's SAB approach).
 * The AudioWorklet posts batches of ~50 ms PCM to the session, which forwards them to the
 * main process via ipcRenderer.invoke('recorder:pcm-chunk').
 */

import { useSyncExternalStore } from 'react';
import { createRecorderSession } from './recorderSession';
import type { RecorderSession, RecorderSnapshot } from './recorderSession';
import { openCapture } from './audioCapture';

// The Window shape is declared once, in src/renderer/global.d.ts.

export type {
  RecordingStatus, RecorderErrorCode, RecorderError, RecordingJobConfig, StopResult,
} from './recorderSession';

/** One session for the whole window. The IPC bridge is read at call time, not import time. */
export const recorderSession: RecorderSession = createRecorderSession({
  api: {
    invoke: (channel, ...args) => window.electronAPI.invoke(channel, ...args),
    on: (channel, listener) => window.electronAPI.on(channel, listener),
    off: (channel, listener) => window.electronAPI.off(channel, listener),
  },
  openCapture,
});

/** The session's state, for components that only display it (the sidebar indicator). */
export function useRecorderSnapshot(): RecorderSnapshot {
  return useSyncExternalStore(recorderSession.subscribe, recorderSession.getSnapshot);
}

export function useRecorder(): RecorderSnapshot & Pick<RecorderSession, 'start' | 'pause' | 'resume' | 'stop'> {
  const snapshot = useRecorderSnapshot();
  return {
    ...snapshot,
    start: recorderSession.start,
    pause: recorderSession.pause,
    resume: recorderSession.resume,
    stop: recorderSession.stop,
  };
}
