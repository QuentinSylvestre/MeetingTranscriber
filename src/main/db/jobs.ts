import { getDb } from './index';
import type { Job, JobStatus } from '../../shared/ipc-types';

// cost_usd is intentionally excluded here: a new job always starts with no
// recorded spend (the column defaults to NULL) and is only ever moved via the
// accumulating updateJobCost() below — never set at creation time.
export function createJob(job: Omit<Job, 'cost_usd'>): void {
  const db = getDb();
  db.prepare(`
    INSERT INTO jobs (id, title, created_at, audio_path, duration_s, provider, model, language, status, error_msg, chunk_count)
    VALUES (@id, @title, @created_at, @audio_path, @duration_s, @provider, @model, @language, @status, @error_msg, @chunk_count)
  `).run(job);
}

export function updateJobStatus(
  id: string,
  status: JobStatus,
  error_msg: string | null = null,
  duration_s?: number
): void {
  const db = getDb();
  if (duration_s !== undefined) {
    db.prepare('UPDATE jobs SET status = @status, error_msg = @error_msg, duration_s = @duration_s WHERE id = @id')
      .run({ id, status, error_msg, duration_s });
  } else {
    db.prepare('UPDATE jobs SET status = @status, error_msg = @error_msg WHERE id = @id')
      .run({ id, status, error_msg });
  }
}

export function getJob(id: string): Job | null {
  const db = getDb();
  return db.prepare('SELECT * FROM jobs WHERE id = ?').get(id) as Job | null;
}

export function listJobs(): Job[] {
  const db = getDb();
  return db.prepare('SELECT * FROM jobs ORDER BY created_at DESC').all() as Job[];
}

export function deleteJob(id: string): void {
  const db = getDb();
  // Cascade deletes transcript_turns and speaker_mappings via FK constraint
  db.prepare('DELETE FROM jobs WHERE id = ?').run(id);
}

export function updateJobTitle(id: string, title: string): void {
  const db = getDb();
  db.prepare('UPDATE jobs SET title = @title WHERE id = @id').run({ title, id });
}

// Accumulates rather than overwrites: a regenerated compte-rendu (or a later
// transcription chunk) is genuinely additional spend on the same job.
export function updateJobCost(id: string, incrementUsd: number): void {
  const db = getDb();
  db.prepare('UPDATE jobs SET cost_usd = COALESCE(cost_usd, 0) + @increment WHERE id = @id')
    .run({ id, increment: incrementUsd });
}
