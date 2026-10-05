/**
 * recorder-orchestrator.test.ts — the main-process recorder against a scripted fake encoder
 * worker. Each test names the observed failure it guards: with an unusable recordings folder
 * the session reported 'recording' on top of a dead encoder, wrote nothing, and then hung on
 * Stop until restart.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const h = vi.hoisted(() => ({
  workers: [] as Array<{ posted: Array<{ type: string }>; terminated: boolean; emit: (e: string, ...a: unknown[]) => boolean }>,
  /** What the fake encoder does with each message it receives. */
  onPost: null as null | ((w: { emit: (e: string, ...a: unknown[]) => boolean }, msg: { type: string }) => void),
  folder: '',
  sent: [] as unknown[],
  blocker: { start: 0, stop: 0 },
  marker: { written: [] as string[], cleared: [] as string[] },
}));

vi.mock('worker_threads', async () => {
  const { EventEmitter } = await import('events');
  class Worker extends EventEmitter {
    posted: Array<{ type: string }> = [];
    terminated = false;
    constructor() { super(); h.workers.push(this); }
    postMessage(msg: { type: string }) { this.posted.push(msg); h.onPost?.(this, msg); }
    terminate() { this.terminated = true; queueMicrotask(() => this.emit('exit', 1)); return Promise.resolve(1); }
  }
  return { Worker };
});
vi.mock('electron', () => ({
  BrowserWindow: { getAllWindows: () => [{ isDestroyed: () => false, webContents: { send: (...a: unknown[]) => h.sent.push(a) } }] },
  dialog: { showMessageBox: vi.fn() },
  powerSaveBlocker: {
    start: vi.fn(() => { h.blocker.start++; return 7; }),
    stop: vi.fn(() => { h.blocker.stop++; }),
    isStarted: vi.fn(() => true),
  },
}));
vi.mock('electron-log', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('../../src/main/settings/store', () => ({ getPreference: vi.fn((key: string) => (key === 'appLanguage' ? 'en' : h.folder)) }));
vi.mock('../../src/main/recorder/loopback', () => ({ loopbackAvailable: () => false }));
vi.mock('../../src/main/recorder/recovery', () => ({
  writeRecordingMarker: vi.fn((p: string) => { h.marker.written.push(p); }),
  clearRecordingMarker: vi.fn((p: string) => { h.marker.cleared.push(p); }),
}));

import {
  startRecording, stopRecording, pauseRecording, resumeRecording, getStatus, getWriteError, getAudioPath, waitForStart,
} from '../../src/main/recorder/index';

/** Fake encoder that behaves: acknowledges start, answers flush. */
const wellBehaved: typeof h.onPost = (w, msg) => {
  if (msg.type === 'start') queueMicrotask(() => w.emit('message', { type: 'started' }));
  if (msg.type === 'flush') queueMicrotask(() => w.emit('message', { type: 'flushed' }));
};

let audioPath: string;

beforeEach(() => {
  h.folder = fs.mkdtempSync(path.join(os.tmpdir(), 'rec-orch-'));
  audioPath = path.join(h.folder, 'job-1.mp3');
  h.workers.length = 0; h.sent.length = 0;
  h.blocker.start = 0; h.blocker.stop = 0;
  h.marker.written.length = 0; h.marker.cleared.length = 0;
  h.onPost = wellBehaved;
});

afterEach(async () => {
  vi.useRealTimers();
  h.onPost = wellBehaved;
  if (getStatus() !== 'idle') { try { await stopRecording(); } catch { /* settled */ } }
  fs.rmSync(h.folder, { recursive: true, force: true });
});

describe('recorder start', () => {
  it('reports recording only after the encoder has opened its file, and holds the power-save blocker', async () => {
    await startRecording('job-1', audioPath);
    expect(getStatus()).toBe('recording');
    expect(h.workers[0].posted.map(m => m.type)).toEqual(['start']);
    expect(h.blocker.start).toBe(1);
    expect(h.marker.written).toEqual([audioPath]);
  });

  it('rejects, and stays idle, when the encoder cannot open its file', async () => {
    h.onPost = (w, msg) => { if (msg.type === 'start') queueMicrotask(() => w.emit('message', { type: 'error', error: 'EACCES: denied' })); };
    await expect(startRecording('job-1', audioPath)).rejects.toThrow('EACCES: denied');
    expect(getStatus()).toBe('idle');
    expect(h.workers[0].terminated).toBe(true);
    expect(h.blocker.start).toBe(0);
    expect(h.marker.written).toEqual([]);
  });

  it('rejects when the encoder dies before acknowledging', async () => {
    h.onPost = (w, msg) => { if (msg.type === 'start') queueMicrotask(() => w.emit('exit', 1)); };
    await expect(startRecording('job-1', audioPath)).rejects.toThrow(/stopped unexpectedly/);
    expect(getStatus()).toBe('idle');
  });

  it('gives up if the encoder never answers', async () => {
    vi.useFakeTimers();
    h.onPost = () => {}; // silent encoder
    const result = startRecording('job-1', audioPath);
    const assertion = expect(result).rejects.toThrow(/did not start within/);
    await vi.advanceTimersByTimeAsync(10_000);
    await assertion;
    expect(getStatus()).toBe('idle');
  });

  it('rejects up front, without creating an encoder, when the recordings folder is unusable', async () => {
    // The folder's parent is a file, so it cannot be created on any platform.
    const blocker = path.join(h.folder, 'blocker');
    fs.writeFileSync(blocker, 'x');
    h.folder = path.join(blocker, 'sub');
    await expect(startRecording('job-1', path.join(h.folder, 'job-1.mp3'))).rejects.toThrow(/recordings folder cannot be used/);
    expect(h.workers.length).toBe(0);
    expect(getStatus()).toBe('idle');
    h.folder = path.dirname(blocker);
  });

  it('refuses a path outside the recordings folder', async () => {
    await expect(startRecording('job-1', path.join(os.tmpdir(), 'elsewhere.mp3'))).rejects.toThrow(/inside the recordings folder/);
  });

  it('refuses a second start while one is active', async () => {
    await startRecording('job-1', audioPath);
    await expect(startRecording('job-2', path.join(h.folder, 'job-2.mp3'))).rejects.toThrow(/already active/);
  });
});

describe('recorder stop', () => {
  it('resolves on flush, ends idle, releases the blocker and clears the marker', async () => {
    await startRecording('job-1', audioPath);
    await stopRecording();
    expect(getStatus()).toBe('idle');
    expect(h.blocker.stop).toBe(1);
    expect(h.marker.cleared).toContain(audioPath);
    expect(getAudioPath()).toBe(audioPath);
  });

  it('settles at once, not after the timeout, when the encoder reports an error during flush', async () => {
    await startRecording('job-1', audioPath);
    h.onPost = (w, msg) => { if (msg.type === 'flush') queueMicrotask(() => w.emit('message', { type: 'error', error: 'ENOSPC' })); };
    await expect(stopRecording()).rejects.toThrow('ENOSPC');
    expect(getStatus()).toBe('idle');
    expect(getWriteError()).toBe('ENOSPC');
    // The file may be partial: the marker stays so the next launch still offers it.
    expect(h.marker.cleared).not.toContain(audioPath);
  });

  it('always settles: a flush that never answers times out and leaves the recorder idle', async () => {
    await startRecording('job-1', audioPath);
    vi.useFakeTimers();
    h.onPost = () => {};
    const result = stopRecording();
    const assertion = expect(result).rejects.toThrow(/flush timed out after 30 seconds/);
    await vi.advanceTimersByTimeAsync(30_000);
    await assertion;
    expect(getStatus()).toBe('idle');
    expect(h.workers[0].terminated).toBe(true);
  });

  it('returns the same promise for a second stop while one is in flight', async () => {
    await startRecording('job-1', audioPath);
    const a = stopRecording();
    const b = stopRecording();
    expect(b).toBe(a);
    await a;
    expect(h.workers[0].posted.filter(m => m.type === 'flush').length).toBe(1);
  });

  it('resolves immediately when idle', async () => {
    await expect(stopRecording()).resolves.toBeUndefined();
  });

  it('ignores the exit event that follows its own terminate()', async () => {
    await startRecording('job-1', audioPath);
    await stopRecording();
    await Promise.resolve(); // let the fake worker's exit event fire
    expect(getStatus()).toBe('idle');
    expect(getWriteError()).toBeNull();
  });
});

describe('stop requested while the recorder is still starting', () => {
  // A window closed in the first moments used to reject with "still starting" and leave the
  // half-built session (and its encoder worker) behind.
  it('waits for the start, then stops the session it produced, leaving nothing running', async () => {
    let ack: () => void = () => {};
    h.onPost = (w, msg) => {
      if (msg.type === 'start') ack = () => w.emit('message', { type: 'started' });
      if (msg.type === 'flush') queueMicrotask(() => w.emit('message', { type: 'flushed' }));
    };
    const started = startRecording('job-1', audioPath);
    expect(getStatus()).toBe('starting');
    const stopped = stopRecording();
    ack(); // the encoder opens its file only now
    await started;
    await stopped;
    expect(getStatus()).toBe('idle');
    expect(h.workers[0].posted.map(m => m.type)).toEqual(['start', 'flush']);
    expect(h.workers[0].terminated).toBe(true);
    expect(h.blocker.start).toBe(h.blocker.stop); // nothing held back
  });

  it('settles quietly when the start it was waiting on fails', async () => {
    h.onPost = (w, msg) => { if (msg.type === 'start') queueMicrotask(() => w.emit('message', { type: 'error', error: 'EACCES' })); };
    const started = startRecording('job-1', audioPath);
    const assertion = expect(started).rejects.toThrow('EACCES');
    await expect(stopRecording()).resolves.toBeUndefined();
    await assertion;
    expect(getStatus()).toBe('idle');
    expect(h.workers[0].terminated).toBe(true);
  });

  it('waitForStart resolves once the start has settled, whichever way it went', async () => {
    h.onPost = (w, msg) => { if (msg.type === 'start') queueMicrotask(() => w.emit('message', { type: 'error', error: 'nope' })); };
    const started = startRecording('job-1', audioPath);
    started.catch(() => {});
    await waitForStart();
    expect(getStatus()).toBe('idle');
  });
});

describe('recorder supervision while recording', () => {
  it('records a write error the encoder reports mid-session and pushes it to the renderer', async () => {
    // Observed: a disk-full style error was posted to a parent that was not listening, so
    // the user saw a normal recording while audio was being lost.
    await startRecording('job-1', audioPath);
    h.workers[0].emit('message', { type: 'error', error: 'ENOSPC: no space left on device' });
    expect(getWriteError()).toBe('ENOSPC: no space left on device');
    expect(getStatus()).toBe('recording');
    const last = h.sent[h.sent.length - 1] as [string, { writeError?: string }];
    expect(last[0]).toBe('recorder:progress');
    expect(last[1].writeError).toBe('ENOSPC: no space left on device');
  });

  it('treats an unexpected encoder exit mid-session as a write error', async () => {
    await startRecording('job-1', audioPath);
    h.workers[0].emit('exit', 1);
    expect(getWriteError()).toMatch(/stopped unexpectedly/);
  });

  it('pauses and resumes', async () => {
    await startRecording('job-1', audioPath);
    pauseRecording();
    expect(getStatus()).toBe('paused');
    resumeRecording();
    expect(getStatus()).toBe('recording');
    expect(h.workers[0].posted.map(m => m.type)).toEqual(['start', 'pause', 'resume']);
  });
});
