ALTER TABLE jobs ADD COLUMN cost_usd REAL;

CREATE TABLE IF NOT EXISTS job_summaries (
  job_id TEXT PRIMARY KEY REFERENCES jobs(id) ON DELETE CASCADE,
  summary_json TEXT NOT NULL,
  transcript_snapshot TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

PRAGMA user_version = 2;
