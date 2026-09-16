import Database from 'better-sqlite3';
import { app } from 'electron';
import * as path from 'path';
import log from 'electron-log';

let _db: Database.Database | null = null;

// Migration SQL is embedded to ensure it is available in the production build.
// The compiled main-process bundle (dist-electron/) does not include
// src/main/db/migrations/, so reading from disk at __dirname would fail.
// The canonical source-of-truth copy lives in src/main/db/migrations/001_initial.sql
// (kept for documentation and review purposes only — not read at runtime).
//
// F4: idx_transcript_turns_job_id covers the hot getTranscript(job_id) query path.
const MIGRATION_001 = `
PRAGMA journal_mode=WAL;

CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  audio_path TEXT NOT NULL,
  duration_s REAL,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  language TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  error_msg TEXT,
  chunk_count INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS transcript_turns (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  chunk_index INTEGER NOT NULL DEFAULT 0,
  speaker_label TEXT NOT NULL,
  start_ms INTEGER NOT NULL,
  end_ms INTEGER NOT NULL,
  text TEXT NOT NULL,
  original_text TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS speaker_mappings (
  job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  chunk_index INTEGER NOT NULL DEFAULT 0,
  speaker_label TEXT NOT NULL,
  display_name TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (job_id, chunk_index, speaker_label)
);

CREATE INDEX IF NOT EXISTS idx_transcript_turns_job_id ON transcript_turns(job_id);
`;

export function getDb(): Database.Database {
  if (!_db) throw new Error('Database not initialized. Call initDb() first.');
  return _db;
}

export function initDb(): void {
  if (_db) return; // guard: only initialize once
  const dbPath = path.join(app.getPath('userData'), 'db.sqlite');
  log.info(`Initializing database at: ${dbPath}`);
  _db = new Database(dbPath);
  // WAL mode for concurrent reads + write performance
  _db.pragma('journal_mode = WAL');
  _db.pragma('foreign_keys = ON'); // Enable cascade deletes

  // F2: wrap migration in a transaction so a partial failure leaves no half-applied schema.
  // All CREATE TABLE / CREATE INDEX statements use IF NOT EXISTS — idempotent on re-run.
  try {
    const migrate = _db.transaction(() => { _db!.exec(MIGRATION_001); });
    migrate();
    log.info('Migration applied successfully');
  } catch (err) {
    log.error('Migration failed:', err);
    throw err;
  }

  log.info('Database initialized');
}

export function closeDb(): void {
  if (_db) {
    _db.close();
    _db = null;
  }
}
