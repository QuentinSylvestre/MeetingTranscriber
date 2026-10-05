/**
 * recorder-session.test.ts — regression tests for the recording session that lives outside
 * React. Each test names the observed failure it guards: leaving the Record view mid-recording
 * used to strand the audio graph, the pause flag and the job id inside an unmounted hook.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  createRecorderSession, RecorderStartError, formatDuration, classifyMicError,
} from '../../src/renderer/hooks/recorderSession';
import type { RecordingJobConfig } from '../../src/renderer/hooks/recorderSession';

const CONFIG: RecordingJobConfig = { provider: 'assemblyai', language: 'en', speakerCountHint: { mode: 'exact', count: 3 } };
const PCM = new Int16Array(2205);

function makeSession(handlers: Record<string, (...a: unknown[]) => unknown> = {}) {
  const invoke = vi.fn(async (channel: string, ...args: unknown[]) => handlers[channel]?.(...args));
  let progress: ((...a: unknown[]) => void) | null = null;
  const api = {
    invoke,
    on: vi.fn((_c: string, l: (...a: unknown[]) => void) => { progress = l; }),
    off: vi.fn(() => { progress = null; }),
  };
  const graph = { close: vi.fn() };
  let batch: (pcm: Int16Array, peak: number) => void = () => {};
  let ended: () => void = () => {};
  const openCapture = vi.fn(async (_mic: string | undefined, onBatch: typeof batch, onEnded: () => void) => {
    batch = onBatch; ended = onEnded; return graph;
  });
  const session = createRecorderSession({ api, openCapture });
  const pcmCalls = () => invoke.mock.calls.filter(c => c[0] === 'recorder:pcm-chunk').length;
  return { session, invoke, api, graph, openCapture, pcmCalls,
    pushBatch: (peak = 0.5, pcm = PCM) => batch(pcm, peak), endInput: () => ended(),
    sendProgress: (p: unknown) => progress?.(p) };
}

describe('recorder session', () => {
  beforeEach(() => { vi.spyOn(console, 'error').mockImplementation(() => {}); vi.spyOn(console, 'warn').mockImplementation(() => {}); });
  afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

  it('forwards PCM while recording and never before main has accepted the start', async () => {
    const t = makeSession({ 'recorder:start': () => { t.pushBatch(); } });
    await t.session.start('job-1', undefined, CONFIG);
    expect(t.session.getSnapshot().status).toBe('recording');
    expect(t.pcmCalls()).toBe(0); // a batch during 'starting' is dropped
    t.pushBatch();
    expect(t.pcmCalls()).toBe(1);
  });

  it('keeps paused across subscriber churn, so a Resume after leaving the view records again', async () => {
    // Observed: pause, open another menu, return, Resume -> timer ran, 0 bytes written,
    // because the first hook instance kept its own pause flag set.
    const t = makeSession();
    await t.session.start('job-1', undefined, CONFIG);
    const unsubscribe = t.session.subscribe(() => {});
    await t.session.pause();
    t.pushBatch();
    expect(t.pcmCalls()).toBe(0);
    unsubscribe(); // the view is unmounted
    const remounted = vi.fn();
    t.session.subscribe(remounted); // and mounted again: a new subscriber, same session
    expect(t.session.getSnapshot().status).toBe('paused');
    await t.session.resume();
    t.pushBatch();
    expect(t.pcmCalls()).toBe(1);
    expect(remounted).toHaveBeenCalled();
  });

  it('returns the job id and the settings captured at start from stop(), whichever view stops it', async () => {
    // Observed: Stop after returning to the view saved the MP3 but started no job, because
    // the job id lived in the unmounted view's state.
    const t = makeSession({ 'recorder:stop': () => ({ audioPath: 'C:/rec/job-9.mp3' }) });
    await t.session.start('job-9', 'mic-1', CONFIG);
    const result = await t.session.stop();
    expect(result).toEqual({ jobId: 'job-9', audioPath: 'C:/rec/job-9.mp3', config: CONFIG });
    expect(t.session.getSnapshot().status).toBe('idle');
    expect(t.session.getSnapshot().jobId).toBeNull();
  });

  it('releases the microphone and audio context on stop', async () => {
    // Observed: after leaving and returning, Stop left the context running and the track live.
    const t = makeSession({ 'recorder:stop': () => ({ audioPath: 'a.mp3' }) });
    await t.session.start('job-1', undefined, CONFIG);
    await t.session.stop();
    expect(t.graph.close).toHaveBeenCalledTimes(1);
    expect(t.api.off).toHaveBeenCalled();
  });

  it('always ends idle when the stop call fails, with an error and no job to start', async () => {
    // Observed: a rejected stop left the view on "Finalizing…" with no buttons, until restart.
    const t = makeSession({ 'recorder:stop': () => { throw new Error("Error invoking remote method 'recorder:stop': Error: boom"); } });
    await t.session.start('job-1', undefined, CONFIG);
    const result = await t.session.stop();
    expect(t.session.getSnapshot().status).toBe('idle');
    expect(result?.error).toEqual({ code: 'stop_failed', detail: 'boom' });
    expect(t.session.getSnapshot().error?.code).toBe('stop_failed');
    expect(t.graph.close).toHaveBeenCalled();
  });

  it('reports a write failure from the encoder and withholds the job', async () => {
    const t = makeSession({ 'recorder:stop': () => ({ audioPath: 'C:/rec/job-1.mp3', writeError: 'ENOSPC' }) });
    await t.session.start('job-1', undefined, CONFIG);
    const result = await t.session.stop();
    expect(result?.error).toEqual({ code: 'write_failed', detail: 'ENOSPC', path: 'C:/rec/job-1.mp3' });
    expect(t.session.getSnapshot().status).toBe('idle');
  });

  it('surfaces a mid-recording write failure pushed by main, and keeps main\'s duration', async () => {
    const t = makeSession();
    await t.session.start('job-1', undefined, CONFIG);
    t.sendProgress({ durationMs: 5000, status: 'recording', writeError: 'disk full' });
    expect(t.session.getSnapshot().durationMs).toBe(5000);
    expect(t.session.getSnapshot().error).toEqual({ code: 'write_failed', detail: 'disk full' });
  });

  it('goes back to idle, closes the graph and names the cause when main refuses to start', async () => {
    // Observed: an unusable recordings folder produced a normal-looking recording.
    const t = makeSession({ 'recorder:start': () => { throw new Error("Error invoking remote method 'recorder:start': Error: The recordings folder cannot be used (Q:\\x)"); } });
    await t.session.start('job-1', undefined, CONFIG);
    const snap = t.session.getSnapshot();
    expect(snap.status).toBe('idle');
    expect(snap.error).toEqual({ code: 'start_failed', detail: 'The recordings folder cannot be used (Q:\\x)' });
    expect(t.graph.close).toHaveBeenCalledTimes(1);
    expect(snap.jobId).toBeNull();
  });

  it('maps a microphone failure to its code', async () => {
    const invoke = vi.fn();
    const session = createRecorderSession({
      api: { invoke, on: vi.fn(), off: vi.fn() },
      openCapture: async () => { throw new RecorderStartError('mic_denied', new Error('x')); },
    });
    await session.start('job-1', undefined, CONFIG);
    expect(session.getSnapshot().error).toEqual({ code: 'mic_denied' });
    expect(invoke).not.toHaveBeenCalled();
  });

  it('ignores a second start and a stop when nothing is recording', async () => {
    const t = makeSession();
    expect(await t.session.stop()).toBeNull();
    await t.session.start('job-1', undefined, CONFIG);
    await t.session.start('job-2', undefined, CONFIG);
    expect(t.openCapture).toHaveBeenCalledTimes(1);
  });

  it('returns to recording and reports it when a pause cannot reach main', async () => {
    const t = makeSession({ 'recorder:pause': () => { throw new Error('nope'); } });
    await t.session.start('job-1', undefined, CONFIG);
    await t.session.pause();
    expect(t.session.getSnapshot().status).toBe('recording');
    expect(t.session.getSnapshot().error?.code).toBe('control_failed');
  });

  it('flags a microphone that ends by itself', async () => {
    const t = makeSession();
    await t.session.start('job-1', undefined, CONFIG);
    expect(t.session.getSnapshot().inputLost).toBe(false);
    t.endInput();
    expect(t.session.getSnapshot().inputLost).toBe(true);
  });

  it('raises the silence warning after 15 s of dead input and clears it on sound', async () => {
    const t = makeSession();
    await t.session.start('job-1', undefined, CONFIG);
    t.pushBatch(0, new Int16Array(44100 * 14));
    expect(t.session.getSnapshot().inputSilent).toBe(false);
    t.pushBatch(0, new Int16Array(44100 * 2));
    expect(t.session.getSnapshot().inputSilent).toBe(true);
    t.pushBatch(0.3);
    expect(t.session.getSnapshot().inputSilent).toBe(false);
  });

  it('does not count paused time as silence', async () => {
    const t = makeSession();
    await t.session.start('job-1', undefined, CONFIG);
    await t.session.pause();
    t.pushBatch(0, new Int16Array(44100 * 60));
    expect(t.session.getSnapshot().inputSilent).toBe(false);
  });

  it('drains the peak into the meter on a fixed cadence and zeroes it when quiet', async () => {
    vi.useFakeTimers();
    const t = makeSession();
    await t.session.start('job-1', undefined, CONFIG);
    t.pushBatch(0.4);
    vi.advanceTimersByTime(100);
    expect(t.session.getSnapshot().inputLevel).toBe(0.4);
    vi.advanceTimersByTime(100);
    expect(t.session.getSnapshot().inputLevel).toBe(0);
  });

  it('hands out the same snapshot object until something changes', async () => {
    const t = makeSession();
    await t.session.start('job-1', undefined, CONFIG);
    const a = t.session.getSnapshot();
    t.pushBatch(0.5); // changes nothing published (level is drained on a timer)
    expect(t.session.getSnapshot()).toBe(a);
  });
});

describe('recorder session helpers', () => {
  it('formats durations as HH:MM:SS', () => {
    expect(formatDuration(0)).toBe('00:00:00');
    expect(formatDuration(3_725_000)).toBe('01:02:05');
    expect(formatDuration(4 * 3600 * 1000)).toBe('04:00:00');
  });
  it('classifies microphone errors by DOMException name', () => {
    const named = (name: string) => Object.assign(new Error('x'), { name });
    expect(classifyMicError(named('NotAllowedError'))).toBe('mic_denied');
    expect(classifyMicError(named('NotFoundError'))).toBe('mic_not_found');
    expect(classifyMicError(named('NotReadableError'))).toBe('mic_busy');
    expect(classifyMicError(new Error('other'))).toBe('unknown');
  });
});
