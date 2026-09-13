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
  text TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS speaker_mappings (
  job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  chunk_index INTEGER NOT NULL DEFAULT 0,
  speaker_label TEXT NOT NULL,
  display_name TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (job_id, chunk_index, speaker_label)
);

-- F4: index on job_id for getTranscript() hot path (full table scan on large meetings)
CREATE INDEX IF NOT EXISTS idx_transcript_turns_job_id ON transcript_turns(job_id);
