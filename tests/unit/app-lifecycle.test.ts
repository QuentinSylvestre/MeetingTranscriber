/**
 * app-lifecycle.test.ts — what happens to a recording or a transcription when the window is
 * closed or the app quits. Observed: closing the window mid-recording exited at once, with no
 * question, no flush and no job, because Windows destroys the window before the quit handler
 * runs and the handler took "no window" to mean "exit".
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const h = vi.hoisted(() => ({
  status: 'idle' as string,
  audioPath: null as string | null,
  activeJob: null as string | null,
  dialogResponse: 0,
  stopFails: false,
  lang: 'en',
  /** What a recorder that is 'starting' turns into once its start settles. */
  startOutcome: 'recording' as string,
}));

vi.mock('electron', () => ({
  app: { on: vi.fn(), quit: vi.fn() },
  dialog: { showMessageBox: vi.fn(async () => ({ response: h.dialogResponse })) },
  BrowserWindow: class {},
}));
vi.mock('electron-log', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('../../src/main/settings/store', () => ({ getPreference: () => h.lang }));
vi.mock('../../src/main/recorder/index', () => ({
  waitForStart: vi.fn(async () => { if (h.status === 'starting') h.status = h.startOutcome; }),
  getStatus: () => h.status,
  getAudioPath: () => h.audioPath,
  stopRecording: vi.fn(async () => { h.status = 'idle'; if (h.stopFails) throw new Error('flush failed'); }),
}));
vi.mock('../../src/main/recorder/recovery', () => ({
  registerRecoveredRecording: vi.fn(),
  clearRecordingMarker: vi.fn(),
}));
vi.mock('../../src/main/transcription/runner', () => ({
  getActiveJobId: () => h.activeJob,
  cancelJob: vi.fn(() => { h.activeJob = null; }),
}));
vi.mock('../../src/main/db/jobs', () => ({ updateJobStatus: vi.fn(), listJobs: () => [] }));

import { dialog } from 'electron';
import { stopRecording } from '../../src/main/recorder/index';
import { registerRecoveredRecording, clearRecordingMarker } from '../../src/main/recorder/recovery';
import { cancelJob } from '../../src/main/transcription/runner';
import { confirmCloseWithActiveWork, registerWindowCloseGuard } from '../../src/main/app-lifecycle';

const liveWindow = () => ({ isDestroyed: () => false }) as never;
const SAVE = 0, DISCARD = 1, CANCEL = 2;

beforeEach(() => {
  vi.clearAllMocks();
  h.status = 'idle'; h.audioPath = null; h.activeJob = null; h.dialogResponse = SAVE; h.stopFails = false;
  h.lang = 'en'; h.startOutcome = 'recording';
});

describe('confirmCloseWithActiveWork: recording', () => {
  it('Stop & Save flushes the recording and adds it to History', async () => {
    h.status = 'recording'; h.audioPath = 'C:/rec/job-1.mp3'; h.dialogResponse = SAVE;
    expect(await confirmCloseWithActiveWork(liveWindow())).toBe(true);
    expect(stopRecording).toHaveBeenCalledTimes(1);
    expect(registerRecoveredRecording).toHaveBeenCalledWith('C:/rec/job-1.mp3');
    expect(clearRecordingMarker).toHaveBeenCalledWith('C:/rec/job-1.mp3');
  });

  it('Cancel keeps the app open and touches nothing', async () => {
    h.status = 'recording'; h.dialogResponse = CANCEL;
    expect(await confirmCloseWithActiveWork(liveWindow())).toBe(false);
    expect(stopRecording).not.toHaveBeenCalled();
  });

  it('Discard flushes, keeps the audio file and does not add it to History', async () => {
    // The audio is never deleted: an accidental click must not destroy a meeting.
    const file = path.join(os.tmpdir(), `lifecycle-discard-${Date.now()}.mp3`);
    fs.writeFileSync(file, 'audio');
    h.status = 'paused'; h.audioPath = file; h.dialogResponse = DISCARD;
    expect(await confirmCloseWithActiveWork(liveWindow())).toBe(true);
    expect(stopRecording).toHaveBeenCalledTimes(1);
    expect(fs.existsSync(file)).toBe(true);
    expect(registerRecoveredRecording).not.toHaveBeenCalled();
    expect(clearRecordingMarker).toHaveBeenCalledWith(file);
    fs.rmSync(file, { force: true });
  });

  it('saves without asking when there is no window to ask through', async () => {
    // The observed failure: no window meant exit, skipping both the question and the flush.
    h.status = 'recording'; h.audioPath = 'C:/rec/job-2.mp3';
    expect(await confirmCloseWithActiveWork(null)).toBe(true);
    expect(dialog.showMessageBox).not.toHaveBeenCalled();
    expect(stopRecording).toHaveBeenCalledTimes(1);
    expect(registerRecoveredRecording).toHaveBeenCalledWith('C:/rec/job-2.mp3');
  });

  it('treats a destroyed window the same as no window', async () => {
    h.status = 'recording'; h.audioPath = 'C:/rec/job-3.mp3';
    expect(await confirmCloseWithActiveWork({ isDestroyed: () => true } as never)).toBe(true);
    expect(dialog.showMessageBox).not.toHaveBeenCalled();
    expect(stopRecording).toHaveBeenCalled();
  });

  it('still closes, and still lists the audio, when the flush fails', async () => {
    h.status = 'recording'; h.audioPath = 'C:/rec/job-4.mp3'; h.stopFails = true;
    expect(await confirmCloseWithActiveWork(liveWindow())).toBe(true);
    expect(registerRecoveredRecording).toHaveBeenCalledWith('C:/rec/job-4.mp3');
  });
});

describe('confirmCloseWithActiveWork: close during start', () => {
  it('lets the start finish, then asks about the recording it produced', async () => {
    h.status = 'starting'; h.startOutcome = 'recording'; h.audioPath = 'C:/rec/job-6.mp3'; h.dialogResponse = SAVE;
    expect(await confirmCloseWithActiveWork(liveWindow())).toBe(true);
    expect(dialog.showMessageBox).toHaveBeenCalledTimes(1);
    expect(stopRecording).toHaveBeenCalledTimes(1);
    expect(registerRecoveredRecording).toHaveBeenCalledWith('C:/rec/job-6.mp3');
  });

  it('closes without a question when the start failed and nothing is recording', async () => {
    h.status = 'starting'; h.startOutcome = 'idle';
    expect(await confirmCloseWithActiveWork(liveWindow())).toBe(true);
    expect(dialog.showMessageBox).not.toHaveBeenCalled();
    expect(stopRecording).not.toHaveBeenCalled();
  });
});

describe('dialog wording follows the app language', () => {
  it('asks in French when the app is in French', async () => {
    h.lang = 'fr'; h.status = 'recording'; h.dialogResponse = CANCEL;
    await confirmCloseWithActiveWork(liveWindow());
    const options = vi.mocked(dialog.showMessageBox).mock.calls[0][1] as { message: string; buttons: string[] };
    expect(options.message).toBe('Enregistrement en cours');
    expect(options.buttons).toEqual(['Arrêter et sauvegarder', 'Abandonner', 'Annuler']);
  });

  it('asks in English otherwise', async () => {
    h.status = 'recording'; h.dialogResponse = CANCEL;
    await confirmCloseWithActiveWork(liveWindow());
    const options = vi.mocked(dialog.showMessageBox).mock.calls[0][1] as { message: string; buttons: string[] };
    expect(options.message).toBe('Recording in progress');
    expect(options.buttons).toEqual(['Stop & Save', 'Discard', 'Cancel']);
  });
});

describe('confirmCloseWithActiveWork: transcription and idle', () => {
  it('lets an idle app close without a question', async () => {
    expect(await confirmCloseWithActiveWork(liveWindow())).toBe(true);
    expect(dialog.showMessageBox).not.toHaveBeenCalled();
  });

  it('asks about an active transcription: Wait keeps the app open', async () => {
    h.activeJob = 'job-9'; h.dialogResponse = 1;
    expect(await confirmCloseWithActiveWork(liveWindow())).toBe(false);
    expect(cancelJob).not.toHaveBeenCalled();
  });

  it('asks about an active transcription: Cancel & Quit cancels it', async () => {
    h.activeJob = 'job-9'; h.dialogResponse = 0;
    expect(await confirmCloseWithActiveWork(liveWindow())).toBe(true);
    expect(cancelJob).toHaveBeenCalledTimes(1);
  });

  it('cancels an active transcription without asking when there is no window', async () => {
    h.activeJob = 'job-9';
    expect(await confirmCloseWithActiveWork(null)).toBe(true);
    expect(cancelJob).toHaveBeenCalledTimes(1);
  });
});

describe('registerWindowCloseGuard', () => {
  function fakeWindow() {
    const handlers: Record<string, (e: { preventDefault: () => void }) => void> = {};
    const win = {
      on: (name: string, fn: (e: { preventDefault: () => void }) => void) => { handlers[name] = fn; },
      isDestroyed: () => false,
      close: vi.fn(() => handlers.close({ preventDefault: () => {} })),
    };
    registerWindowCloseGuard(win as never);
    return { win, close: (e = { preventDefault: vi.fn() }) => { handlers.close(e); return e; } };
  }
  const settle = () => new Promise(r => setTimeout(r, 0));

  it('does not interfere when nothing is running', () => {
    const { close } = fakeWindow();
    expect(close().preventDefault).not.toHaveBeenCalled();
  });

  it('holds the close while recording, then closes for real once the user agrees', async () => {
    h.status = 'recording'; h.audioPath = 'C:/rec/job-5.mp3'; h.dialogResponse = SAVE;
    const { win, close } = fakeWindow();
    const event = close();
    expect(event.preventDefault).toHaveBeenCalled();
    await settle();
    expect(stopRecording).toHaveBeenCalledTimes(1);
    expect(win.close).toHaveBeenCalledTimes(1); // and that second close was let through
  });

  it('keeps the window open when the user cancels', async () => {
    h.status = 'recording'; h.dialogResponse = CANCEL;
    const { win, close } = fakeWindow();
    close();
    await settle();
    expect(win.close).not.toHaveBeenCalled();
    expect(stopRecording).not.toHaveBeenCalled();
  });

  it('asks only once when close is requested repeatedly while the dialog is open', async () => {
    h.status = 'recording'; h.dialogResponse = CANCEL;
    const { close } = fakeWindow();
    close(); close(); close();
    await settle();
    expect(dialog.showMessageBox).toHaveBeenCalledTimes(1);
  });
});
