import { getDb } from './index';
import type { TranscriptTurn, SpeakerMapping } from '../../shared/ipc-types';

export function saveTranscript(turns: TranscriptTurn[]): void {
  if (turns.length === 0) return;
  const db = getDb();
  const stmt = db.prepare(`
    INSERT INTO transcript_turns (id, job_id, chunk_index, speaker_label, start_ms, end_ms, text, original_text)
    VALUES (@id, @job_id, @chunk_index, @speaker_label, @start_ms, @end_ms, @text, @text)
  `);
  // F3 fix: batch transaction keeps per-turn write latency sub-millisecond
  const insertAll = db.transaction((turns: TranscriptTurn[]) => {
    for (const turn of turns) {
      stmt.run(turn);
    }
  });
  insertAll(turns);
}

export function getTranscript(job_id: string): TranscriptTurn[] {
  const db = getDb();
  return db.prepare(
    'SELECT * FROM transcript_turns WHERE job_id = ? ORDER BY start_ms ASC'
  ).all(job_id) as TranscriptTurn[];
}

export function updateSpeakerMapping(
  job_id: string,
  chunk_index: number,
  speaker_label: string,
  display_name: string
): void {
  const db = getDb();
  db.prepare(`
    INSERT INTO speaker_mappings (job_id, chunk_index, speaker_label, display_name)
    VALUES (@job_id, @chunk_index, @speaker_label, @display_name)
    ON CONFLICT(job_id, chunk_index, speaker_label) DO UPDATE SET display_name = excluded.display_name
  `).run({ job_id, chunk_index, speaker_label, display_name });
}

export function getSpeakerMappings(job_id: string): SpeakerMapping[] {
  const db = getDb();
  return db.prepare(
    'SELECT * FROM speaker_mappings WHERE job_id = ?'
  ).all(job_id) as SpeakerMapping[];
}

export function updateTurnText(id: string, text: string): void {
  const db = getDb();
  db.prepare('UPDATE transcript_turns SET text = @text WHERE id = @id').run({ text, id });
}

export function resetTranscript(job_id: string): TranscriptTurn[] {
  const db = getDb();
  const reset = db.transaction(() => {
    db.prepare('UPDATE transcript_turns SET text = original_text WHERE job_id = @job_id').run({ job_id });
    return db.prepare(
      'SELECT * FROM transcript_turns WHERE job_id = ? ORDER BY start_ms ASC'
    ).all(job_id) as TranscriptTurn[];
  });
  return reset();
}
