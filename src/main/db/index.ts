import Database from 'better-sqlite3';
import { app } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
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

// Adds jobs.cost_usd (accumulating spend tracker) and job_summaries (persisted
// compte-rendu JSON + transcript snapshot, for re-render without re-billing).
// PRAGMA user_version = 2 is the LAST statement in this SQL text on purpose: it
// commits inside the same transaction as the ALTER TABLE/CREATE TABLE above, so
// a crash between the schema change and the version bump is impossible by
// construction (see Design Decisions: "Migration atomicity").
// The canonical source-of-truth copy lives in
// src/main/db/migrations/002_add_cost_and_summaries.sql (documentation/review
// only — not read at runtime, mirroring 001_initial.sql's treatment).
const MIGRATION_002 = `
ALTER TABLE jobs ADD COLUMN cost_usd REAL;

CREATE TABLE IF NOT EXISTS job_summaries (
  job_id TEXT PRIMARY KEY REFERENCES jobs(id) ON DELETE CASCADE,
  summary_json TEXT NOT NULL,
  transcript_snapshot TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

PRAGMA user_version = 2;
`;

export function getDb(): Database.Database {
  if (!_db) throw new Error('Database not initialized. Call initDb() first.');
  return _db;
}

export function initDb(): void {
  if (_db) return; // guard: only initialize once
  const dbPath = path.join(app.getPath('userData'), 'db.sqlite');
  // Checked BEFORE `new Database(dbPath)` below, which creates the file if absent.
  // This — not `PRAGMA user_version` — is the correct fresh-vs-existing signal:
  // user_version reads 0 for both a brand-new file AND every database that
  // predates this versioning scheme (i.e. the real, populated db.sqlite this app
  // ships today). Branching the backup decision on user_version alone would skip
  // it on exactly the one transition it exists to protect.
  const dbAlreadyExisted = fs.existsSync(dbPath);
  log.info(`Initializing database at: ${dbPath}`);
  _db = new Database(dbPath);
  // WAL mode for concurrent reads + write performance
  _db.pragma('journal_mode = WAL');
  _db.pragma('foreign_keys = ON'); // Enable cascade deletes
  // A lock conflict from a second process touching the same file retries for up
  // to 5s instead of failing/racing immediately. A broader fix (an app-level
  // app.requestSingleInstanceLock()) is out of scope for this file.
  _db.pragma('busy_timeout = 5000');

  // F2: wrap migration in a transaction so a partial failure leaves no half-applied schema.
  // All CREATE TABLE / CREATE INDEX statements use IF NOT EXISTS — idempotent on re-run.
  try {
    const migrate1 = _db.transaction(() => { _db!.exec(MIGRATION_001); });
    migrate1();
    log.info('Migration applied successfully');
  } catch (err) {
    log.error('Migration failed:', err);
    throw err;
  }

  const version = _db.pragma('user_version', { simple: true }) as number;

  try {
    if (dbAlreadyExisted && version < 2) {
      // Safety net mirroring this project's established precedent for schema changes
      // against a live personal database. `dbAlreadyExisted` is the correct signal
      // (see comment above) — a fresh install (no pre-existing file, no real data
      // yet) skips this backup entirely.
      // The app runs in WAL mode: recent commits can still live only in
      // `-wal`, so checkpoint first to make the copy a complete snapshot.
      const checkpointResult = _db.pragma('wal_checkpoint(TRUNCATE)') as Array<{
        busy: number;
        log: number;
        checkpointed: number;
      }>;
      if (checkpointResult[0]?.busy) {
        log.warn(
          'wal_checkpoint(TRUNCATE) reported busy before the pre-migration backup — ' +
          'the backup copy may not include all recently-committed WAL data. Proceeding anyway.'
        );
      }
      const backupPath = `${dbPath}.bak-pre-v2-${Date.now()}`;
      try {
        fs.copyFileSync(dbPath, backupPath);
      } catch (backupErr) {
        // Best-effort cleanup: don't leave a partial/corrupt backup file behind
        // for a future run to be confused by.
        try {
          if (fs.existsSync(backupPath)) fs.unlinkSync(backupPath);
        } catch (cleanupErr) {
          log.error('Failed to remove partial pre-migration backup file after a failed backup:', cleanupErr);
        }
        throw backupErr;
      }
      log.info(`Pre-migration backup created at: ${backupPath}`);
    }

    if (version < 2) {
      // PRAGMA user_version = 2 is the last statement inside MIGRATION_002 itself, so
      // the schema change and the version bump commit as one atomic unit.
      const migrate2 = _db.transaction(() => { _db!.exec(MIGRATION_002); });
      migrate2();
      log.info('MIGRATION_002 applied successfully');
    }
  } catch (err) {
    log.error('MIGRATION_002 (or its pre-migration backup) failed:', err);
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
