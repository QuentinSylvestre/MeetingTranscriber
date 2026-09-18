import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import * as path from 'path';
import * as fs from 'fs';

// DB tests require better-sqlite3 built for the current Node ABI.
// After `npm run dev` (which rebuilds for Electron ABI 135), these will fail
// under plain Node ABI 137. We attempt the import and skip the suite if it fails.
let Database: typeof import('better-sqlite3').default | null = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  Database = require('better-sqlite3') as typeof import('better-sqlite3').default;
} catch {
  // ABI mismatch — skip suite
}

let db: import('better-sqlite3').Database;

// Hoist the mock so it applies before any module is imported.
// The factory captures `db` by reference — the beforeAll assignment lands before
// the first test runs, so every getDb() call sees the real in-memory instance.
vi.mock('../../src/main/db/index', () => ({
  getDb: () => db,
  initDb: vi.fn(),
  closeDb: vi.fn(),
}));

// Electron is not present in Vitest's Node environment.
vi.mock('electron', () => ({
  app: { getPath: vi.fn(() => '/tmp/test'), ipcMain: {} },
  ipcMain: { handle: vi.fn() },
}));

const MIGRATIONS_DIR = path.join(
  process.cwd(),
  'src', 'main', 'db', 'migrations'
);

beforeAll(() => {
  if (!Database) return; // ABI mismatch — skip
  db = new Database(':memory:');
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, '001_initial.sql'), 'utf-8');
  db.exec(sql);
  const sql002 = fs.readFileSync(path.join(MIGRATIONS_DIR, '002_add_cost_and_summaries.sql'), 'utf-8');
  db.exec(sql002);
});

afterAll(() => {
  if (db) db.close();
});

describe.skipIf(!Database)('jobs CRUD', () => {
  it('creates and retrieves a job', async () => {
    const { createJob, getJob } = await import('../../src/main/db/jobs');
    const job = {
      id: 'job-001',
      title: 'Test Meeting',
      created_at: Date.now(),
      audio_path: '/tmp/test.mp3',
      duration_s: 120,
      provider: 'assemblyai' as const,
      model: 'universal',
      language: 'fr' as const,
      status: 'pending' as const,
      error_msg: null,
      chunk_count: 1,
    };
    createJob(job);
    const retrieved = getJob('job-001');
    expect(retrieved).not.toBeNull();
    expect(retrieved?.title).toBe('Test Meeting');
    expect(retrieved?.provider).toBe('assemblyai');
  });

  it('updates job status', async () => {
    const { updateJobStatus, getJob } = await import('../../src/main/db/jobs');
    updateJobStatus('job-001', 'done', null, 130.5);
    const job = getJob('job-001');
    expect(job?.status).toBe('done');
    expect(job?.duration_s).toBe(130.5);
  });

  it('lists jobs in reverse chronological order', async () => {
    const { createJob, listJobs } = await import('../../src/main/db/jobs');
    createJob({
      id: 'job-002',
      title: 'Second Job',
      created_at: Date.now() + 1000,
      audio_path: '/tmp/test2.mp3',
      duration_s: null,
      provider: 'openai' as const,
      model: 'gpt-4o-transcribe-diarize',
      language: 'en' as const,
      status: 'pending' as const,
      error_msg: null,
      chunk_count: 2,
    });
    const jobs = listJobs();
    expect(jobs.length).toBeGreaterThanOrEqual(2);
    expect(jobs[0].id).toBe('job-002'); // Most recent first
  });

  it('cascade deletes transcript_turns and speaker_mappings', async () => {
    const { createJob, deleteJob } = await import('../../src/main/db/jobs');
    const { saveTranscript, getTranscript, updateSpeakerMapping, getSpeakerMappings } = await import('../../src/main/db/transcript');

    createJob({
      id: 'job-cascade',
      title: 'Cascade Test',
      created_at: Date.now(),
      audio_path: '/tmp/cascade.mp3',
      duration_s: null,
      provider: 'elevenlabs' as const,
      model: 'scribe_v2',
      language: 'fr' as const,
      status: 'pending' as const,
      error_msg: null,
      chunk_count: 1,
    });
    saveTranscript([
      { id: 'turn-1', job_id: 'job-cascade', chunk_index: 0, speaker_label: 'Speaker A', start_ms: 0, end_ms: 1000, text: 'Hello', original_text: 'Hello' },
    ]);
    updateSpeakerMapping('job-cascade', 0, 'Speaker A', 'Alice');

    deleteJob('job-cascade');

    expect(getTranscript('job-cascade')).toHaveLength(0);
    expect(getSpeakerMappings('job-cascade')).toHaveLength(0);
  });

  it('updateJobTitle updates the title in the database', async () => {
    const { createJob, getJob, updateJobTitle } = await import('../../src/main/db/jobs');
    createJob({
      id: 'job-title',
      title: 'Original Title',
      created_at: Date.now(),
      audio_path: '/tmp/title-test.mp3',
      duration_s: null,
      provider: 'assemblyai' as const,
      model: 'universal',
      language: 'fr' as const,
      status: 'pending' as const,
      error_msg: null,
      chunk_count: 1,
    });

    updateJobTitle('job-title', 'Updated Title');

    const job = getJob('job-title');
    expect(job?.title).toBe('Updated Title');
  });

  it('updateJobTitle on nonexistent id runs without throwing', async () => {
    const { updateJobTitle } = await import('../../src/main/db/jobs');
    expect(() => updateJobTitle('nonexistent-id', 'x')).not.toThrow();
  });
});

describe.skipIf(!Database)('transcript CRUD', () => {
  it('batch insert of 1000 turns completes in < 50ms', async () => {
    const { createJob } = await import('../../src/main/db/jobs');
    const { saveTranscript, getTranscript } = await import('../../src/main/db/transcript');

    createJob({
      id: 'job-perf',
      title: 'Performance Test',
      created_at: Date.now(),
      audio_path: '/tmp/perf.mp3',
      duration_s: null,
      provider: 'assemblyai' as const,
      model: 'universal',
      language: 'fr' as const,
      status: 'pending' as const,
      error_msg: null,
      chunk_count: 1,
    });

    const turns = Array.from({ length: 1000 }, (_, i) => ({
      id: `turn-perf-${i}`,
      job_id: 'job-perf',
      chunk_index: 0,
      speaker_label: 'Speaker A',
      start_ms: i * 100,
      end_ms: i * 100 + 100,
      text: `Turn ${i} text content`,
      original_text: `Turn ${i} text content`,
    }));

    const start = Date.now();
    saveTranscript(turns);
    const elapsed = Date.now() - start;

    expect(elapsed).toBeLessThan(50);
    expect(getTranscript('job-perf')).toHaveLength(1000);
  });

  it('saves and retrieves speaker mappings with upsert', async () => {
    const { updateSpeakerMapping, getSpeakerMappings } = await import('../../src/main/db/transcript');

    // Use job-001 which was created in the jobs tests
    updateSpeakerMapping('job-001', 0, 'Speaker A', 'Alice');
    updateSpeakerMapping('job-001', 0, 'Speaker A', 'Alice Updated'); // upsert

    const mappings = getSpeakerMappings('job-001');
    const aliceMapping = mappings.find(m => m.speaker_label === 'Speaker A');
    expect(aliceMapping?.display_name).toBe('Alice Updated');
  });

  it('updateTurnText updates text but not original_text', async () => {
    const { saveTranscript, getTranscript, updateTurnText } = await import('../../src/main/db/transcript');
    const { createJob } = await import('../../src/main/db/jobs');
    createJob({
      id: 'job-edit',
      title: 'Edit Test',
      created_at: Date.now(),
      audio_path: '/tmp/edit.mp3',
      duration_s: null,
      provider: 'assemblyai' as const,
      model: 'universal',
      language: 'fr' as const,
      status: 'pending' as const,
      error_msg: null,
      chunk_count: 1,
    });
    saveTranscript([{
      id: 'turn-edit-1',
      job_id: 'job-edit',
      chunk_index: 0,
      speaker_label: 'A',
      start_ms: 0,
      end_ms: 1000,
      text: 'Original',
      original_text: 'Original',
    }]);
    updateTurnText('turn-edit-1', 'Corrected');
    const [turn] = getTranscript('job-edit');
    expect(turn.text).toBe('Corrected');
    expect(turn.original_text).toBe('Original');
  });

  it('resetTranscript restores text from original_text for all turns', async () => {
    const { saveTranscript, getTranscript, updateTurnText, resetTranscript } = await import('../../src/main/db/transcript');
    const { createJob } = await import('../../src/main/db/jobs');
    createJob({
      id: 'job-reset',
      title: 'Reset Test',
      created_at: Date.now(),
      audio_path: '/tmp/reset.mp3',
      duration_s: null,
      provider: 'assemblyai' as const,
      model: 'universal',
      language: 'fr' as const,
      status: 'pending' as const,
      error_msg: null,
      chunk_count: 1,
    });
    saveTranscript([{
      id: 'turn-reset-1',
      job_id: 'job-reset',
      chunk_index: 0,
      speaker_label: 'A',
      start_ms: 0,
      end_ms: 1000,
      text: 'Original',
      original_text: 'Original',
    }]);
    updateTurnText('turn-reset-1', 'Edited');
    const resetTurns = resetTranscript('job-reset');
    expect(resetTurns[0].text).toBe('Original');
    expect(resetTurns[0].original_text).toBe('Original');
    // Verify DB state matches
    expect(getTranscript('job-reset')[0].text).toBe('Original');
  });
});

describe.skipIf(!Database)('cost tracking and summary persistence', () => {
  it('updateJobCost accumulates rather than overwrites across two calls', async () => {
    const { createJob, updateJobCost, getJob } = await import('../../src/main/db/jobs');
    createJob({
      id: 'job-cost',
      title: 'Cost Test',
      created_at: Date.now(),
      audio_path: '/tmp/cost.mp3',
      duration_s: null,
      provider: 'assemblyai' as const,
      model: 'universal',
      language: 'fr' as const,
      status: 'pending' as const,
      error_msg: null,
      chunk_count: 1,
    });

    updateJobCost('job-cost', 0.05);
    updateJobCost('job-cost', 0.03);

    const job = getJob('job-cost');
    expect(job?.cost_usd).toBeCloseTo(0.08, 10);
  });

  it('saveSummaryRecord/getSummaryRecord round-trip', async () => {
    const { createJob } = await import('../../src/main/db/jobs');
    const { saveSummaryRecord, getSummaryRecord } = await import('../../src/main/db/summaries');
    createJob({
      id: 'job-summary',
      title: 'Summary Test',
      created_at: Date.now(),
      audio_path: '/tmp/summary.mp3',
      duration_s: null,
      provider: 'openai' as const,
      model: 'gpt-4o-transcribe-diarize',
      language: 'fr' as const,
      status: 'done' as const,
      error_msg: null,
      chunk_count: 1,
    });

    const summaryJson = JSON.stringify({ topics: [] });
    saveSummaryRecord('job-summary', summaryJson, 'transcript snapshot text');

    const record = getSummaryRecord('job-summary');
    expect(record).not.toBeNull();
    expect(record?.summary_json).toBe(summaryJson);
    expect(record?.transcript_snapshot).toBe('transcript snapshot text');
    expect(typeof record?.created_at).toBe('number');

    // Regenerating replaces rather than duplicates (SC-8: only the latest is retained).
    const secondSummaryJson = JSON.stringify({ topics: ['updated'] });
    saveSummaryRecord('job-summary', secondSummaryJson, 'updated snapshot');

    const updated = getSummaryRecord('job-summary');
    expect(updated?.summary_json).toBe(secondSummaryJson);
    expect(updated?.transcript_snapshot).toBe('updated snapshot');
  });

  it('job_summaries cascades on deleteJob', async () => {
    const { createJob, deleteJob } = await import('../../src/main/db/jobs');
    const { saveSummaryRecord, getSummaryRecord } = await import('../../src/main/db/summaries');
    createJob({
      id: 'job-summary-cascade',
      title: 'Summary Cascade Test',
      created_at: Date.now(),
      audio_path: '/tmp/summary-cascade.mp3',
      duration_s: null,
      provider: 'openai' as const,
      model: 'gpt-4o-transcribe-diarize',
      language: 'fr' as const,
      status: 'done' as const,
      error_msg: null,
      chunk_count: 1,
    });
    saveSummaryRecord('job-summary-cascade', JSON.stringify({ topics: [] }), 'snapshot');
    expect(getSummaryRecord('job-summary-cascade')).not.toBeNull();

    deleteJob('job-summary-cascade');

    expect(getSummaryRecord('job-summary-cascade')).toBeNull();
  });
});

