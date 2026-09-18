import { getDb } from './index';

export interface JobSummaryRecord {
  job_id: string;
  summary_json: string;
  transcript_snapshot: string;
  created_at: number; // Unix ms
}

// One record per job — a new generation replaces (not duplicates) the previous
// one, per SC-8 ("only the latest is retained").
export function saveSummaryRecord(
  jobId: string,
  summaryJson: string,
  transcriptSnapshot: string
): void {
  const db = getDb();
  db.prepare(`
    INSERT INTO job_summaries (job_id, summary_json, transcript_snapshot, created_at)
    VALUES (@job_id, @summary_json, @transcript_snapshot, @created_at)
    ON CONFLICT(job_id) DO UPDATE SET
      summary_json = excluded.summary_json,
      transcript_snapshot = excluded.transcript_snapshot,
      created_at = excluded.created_at
  `).run({
    job_id: jobId,
    summary_json: summaryJson,
    transcript_snapshot: transcriptSnapshot,
    created_at: Date.now(),
  });
}

export function getSummaryRecord(jobId: string): JobSummaryRecord | null {
  const db = getDb();
  const record = db.prepare(
    'SELECT * FROM job_summaries WHERE job_id = ?'
  ).get(jobId) as JobSummaryRecord | undefined;
  // better-sqlite3's .get() returns undefined (not null) on no match.
  return record ?? null;
}
