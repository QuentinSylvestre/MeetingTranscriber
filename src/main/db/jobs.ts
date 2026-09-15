import { getDb } from './index';
import type { Job, JobStatus } from '../../shared/ipc-types';

export function createJob(job: Job): void {
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
  db.prepare('UPDATE jobs SET title = ? WHERE id = ?').run(title, id);
}
