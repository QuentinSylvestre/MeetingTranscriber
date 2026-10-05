/**
 * recovery.ts — keeps a recording that never reached transcription from vanishing.
 *
 * A job row is only created when transcription starts, so a recording that ends any
 * other way (app killed, power loss, window closed mid-session) used to leave an MP3 in
 * the recordings folder that nothing in the app knew about. A marker file next to the
 * MP3 exists for exactly the span of a session: written at start, removed on a clean
 * stop. A marker found at launch means the session was interrupted.
 *
 * A marker, rather than "any MP3 without a job row", so a recording the user already
 * deleted from History is never resurrected.
 */

import * as fs from 'fs';
import * as path from 'path';
import log from 'electron-log';
import { createJob, listJobs } from '../db/jobs';
import { getPreference } from '../settings/store';
import { msg } from '../messages';

const MARKER_SUFFIX = '.recording';

function markerPath(audioPath: string): string {
  return audioPath + MARKER_SUFFIX;
}

/** Written when a session starts. Best effort: failing to write it must not block recording. */
export function writeRecordingMarker(audioPath: string): void {
  try {
    fs.writeFileSync(markerPath(audioPath), String(Date.now()));
  } catch (err) {
    log.warn('Could not write recording marker:', err);
  }
}

export function clearRecordingMarker(audioPath: string): void {
  try {
    fs.rmSync(markerPath(audioPath), { force: true });
  } catch (err) {
    log.warn('Could not remove recording marker:', err);
  }
}

/**
 * Adds a recording to History as a failed job so the user can find and play it. No-op if
 * the file is missing or empty, or a job already points at it.
 */
export function registerRecoveredRecording(audioPath: string): boolean {
  let size = 0;
  try { size = fs.statSync(audioPath).size; } catch { return false; }
  if (size === 0) return false;
  if (listJobs().some(j => j.audio_path === audioPath)) return false;

  const id = path.basename(audioPath, path.extname(audioPath));
  createJob({
    id,
    title: msg('recovered_title', { date: new Date(fs.statSync(audioPath).mtimeMs).toLocaleString() }),
    created_at: Date.now(),
    audio_path: audioPath,
    duration_s: null,
    provider: getPreference('defaultProvider'),
    model: '',
    language: getPreference('defaultLanguage'),
    status: 'failed',
    error_msg: msg('recovered_error'),
    chunk_count: 1,
  });
  return true;
}

/**
 * Called once at startup, after the database is open. Only the top level of the
 * recordings folder is scanned; markers are always created next to the MP3.
 */
export function recoverInterruptedRecordings(): void {
  let folder: string;
  let entries: string[];
  try {
    folder = getPreference('recordingsFolder');
    entries = fs.readdirSync(folder);
  } catch {
    return; // folder absent or unreachable: nothing to recover
  }
  let recovered = 0;
  for (const name of entries) {
    if (!name.endsWith(MARKER_SUFFIX)) continue;
    const audioPath = path.join(folder, name.slice(0, -MARKER_SUFFIX.length));
    try {
      if (registerRecoveredRecording(audioPath)) recovered++;
    } catch (err) {
      log.error(`Could not recover recording ${audioPath}:`, err);
      continue; // keep the marker so the next launch retries
    }
    clearRecordingMarker(audioPath);
  }
  if (recovered > 0) log.info(`Recovered ${recovered} interrupted recording(s) into History`);
}
