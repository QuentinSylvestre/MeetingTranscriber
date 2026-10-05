/**
 * recorder-recovery.test.ts — interrupted recordings come back into History at launch.
 * Observed: after the app was closed or killed mid-recording, the MP3 survived in the
 * recordings folder but nothing in the app knew about it.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const h = vi.hoisted(() => ({
  folder: '',
  jobs: [] as Array<{ id: string; audio_path: string; status?: string; error_msg?: string | null; title?: string }>,
  createJobFails: false,
  lang: 'en',
}));

vi.mock('electron-log', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('../../src/main/db/jobs', () => ({
  listJobs: () => h.jobs,
  createJob: (j: { id: string; audio_path: string }) => {
    if (h.createJobFails) throw new Error('db closed');
    h.jobs.push(j);
  },
}));
vi.mock('../../src/main/settings/store', () => ({
  getPreference: (key: string) => (key === 'recordingsFolder' ? h.folder : key === 'defaultProvider' ? 'assemblyai' : key === 'appLanguage' ? h.lang : 'fr'),
}));

import {
  writeRecordingMarker, clearRecordingMarker, registerRecoveredRecording, recoverInterruptedRecordings,
} from '../../src/main/recorder/recovery';

let mp3: string;

beforeEach(() => {
  h.folder = fs.mkdtempSync(path.join(os.tmpdir(), 'rec-recovery-'));
  h.jobs.length = 0;
  h.createJobFails = false;
  h.lang = 'en';
  mp3 = path.join(h.folder, 'job-123.mp3');
});
afterEach(() => { fs.rmSync(h.folder, { recursive: true, force: true }); });

describe('recording markers', () => {
  it('writes a marker next to the audio and removes it', () => {
    writeRecordingMarker(mp3);
    expect(fs.existsSync(mp3 + '.recording')).toBe(true);
    clearRecordingMarker(mp3);
    expect(fs.existsSync(mp3 + '.recording')).toBe(false);
  });

  it('does not throw when the marker cannot be written', () => {
    expect(() => writeRecordingMarker(path.join(h.folder, 'no-such-dir', 'x.mp3'))).not.toThrow();
  });
});

describe('registerRecoveredRecording', () => {
  it('adds a failed job pointing at the audio, with an explanatory message', () => {
    fs.writeFileSync(mp3, 'audio');
    expect(registerRecoveredRecording(mp3)).toBe(true);
    expect(h.jobs).toHaveLength(1);
    expect(h.jobs[0]).toMatchObject({ id: 'job-123', audio_path: mp3, status: 'failed' });
    expect(h.jobs[0].error_msg).toMatch(/Upload/);
    expect(h.jobs[0].title).toMatch(/^Recovered recording/);
  });

  it('words the recovered job in the app language', () => {
    h.lang = 'fr';
    fs.writeFileSync(mp3, 'audio');
    registerRecoveredRecording(mp3);
    expect(h.jobs[0].title).toMatch(/^Enregistrement récupéré/);
    expect(h.jobs[0].error_msg).toMatch(/Transcrire/);
  });

  it('does nothing for a missing or empty file', () => {
    expect(registerRecoveredRecording(mp3)).toBe(false);
    fs.writeFileSync(mp3, '');
    expect(registerRecoveredRecording(mp3)).toBe(false);
    expect(h.jobs).toHaveLength(0);
  });

  it('does not duplicate a recording that already has a job', () => {
    fs.writeFileSync(mp3, 'audio');
    h.jobs.push({ id: 'job-123', audio_path: mp3 });
    expect(registerRecoveredRecording(mp3)).toBe(false);
    expect(h.jobs).toHaveLength(1);
  });
});

describe('recoverInterruptedRecordings', () => {
  it('recovers a recording whose marker survived, and clears the marker', () => {
    fs.writeFileSync(mp3, 'audio');
    writeRecordingMarker(mp3);
    recoverInterruptedRecordings();
    expect(h.jobs.map(j => j.audio_path)).toEqual([mp3]);
    expect(fs.existsSync(mp3 + '.recording')).toBe(false);
  });

  it('never resurrects a recording the user deleted: no marker, no job', () => {
    fs.writeFileSync(mp3, 'audio'); // an MP3 with no marker and no job row
    recoverInterruptedRecordings();
    expect(h.jobs).toHaveLength(0);
  });

  it('clears a stale marker whose audio is gone', () => {
    writeRecordingMarker(mp3);
    recoverInterruptedRecordings();
    expect(h.jobs).toHaveLength(0);
    expect(fs.existsSync(mp3 + '.recording')).toBe(false);
  });

  it('keeps the marker when the job cannot be created, so the next launch retries', () => {
    fs.writeFileSync(mp3, 'audio');
    writeRecordingMarker(mp3);
    h.createJobFails = true;
    recoverInterruptedRecordings();
    expect(fs.existsSync(mp3 + '.recording')).toBe(true);
  });

  it('does nothing when the recordings folder does not exist', () => {
    h.folder = path.join(h.folder, 'gone');
    expect(() => recoverInterruptedRecordings()).not.toThrow();
  });
});
