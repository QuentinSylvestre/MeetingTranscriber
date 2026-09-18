import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_PRICING_RATES } from '../../src/shared/ipc-types';

interface FakeSummaryRecord { job_id: string; summary_json: string; transcript_snapshot: string; created_at: number }

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (...args: any[]) => any>(),
  getJob: vi.fn(), getTranscript: vi.fn(), getSpeakerMappings: vi.fn(), getSecretPlaintext: vi.fn(), getPreference: vi.fn(),
  showSaveDialog: vi.fn(), openPath: vi.fn(), writeFile: vi.fn(), rename: vi.fn(), rm: vi.fn(),
  generateSummary: vi.fn(), renderSummaryDocx: vi.fn(), updateJobCost: vi.fn(),
  saveSummaryRecord: vi.fn(), getSummaryRecord: vi.fn(),
}));
vi.mock('electron', () => ({ ipcMain: { handle: (name: string, fn: (...args: any[]) => any) => mocks.handlers.set(name, fn) },
  BrowserWindow: { fromWebContents: () => null }, dialog: { showSaveDialog: mocks.showSaveDialog }, shell: { openPath: mocks.openPath } }));
vi.mock('fs', () => ({ promises: { writeFile: mocks.writeFile, rename: mocks.rename, rm: mocks.rm } }));
vi.mock('../../src/main/db/jobs', () => ({ getJob: mocks.getJob, updateJobCost: mocks.updateJobCost }));
vi.mock('../../src/main/db/summaries', () => ({ saveSummaryRecord: mocks.saveSummaryRecord, getSummaryRecord: mocks.getSummaryRecord }));
vi.mock('../../src/main/db/transcript', () => ({ getTranscript: mocks.getTranscript, getSpeakerMappings: mocks.getSpeakerMappings }));
vi.mock('../../src/main/settings/store', () => ({ getSecretPlaintext: mocks.getSecretPlaintext, getPreference: mocks.getPreference }));
vi.mock('../../src/main/summary/render-docx', () => ({ renderSummaryDocx: mocks.renderSummaryDocx }));
vi.mock('../../src/main/summary/generate', async importOriginal => ({ ...await importOriginal<object>(), generateSummary: mocks.generateSummary }));
import { pendingPersist, registerSummaryHandlers } from '../../src/main/ipc/summary';
import { SummaryError } from '../../src/main/summary/generate';

const run = () => mocks.handlers.get('summary:generate')!({ sender: {} }, { jobId: 'job' });
const rerender = (jobId = 'job') => mocks.handlers.get('summary:rerender')!({ sender: {} }, { jobId });
const state = (jobId = 'job') => mocks.handlers.get('summary:state')!({}, { jobId });
const open = (jobId = 'job') => mocks.handlers.get('summary:open')!({}, { jobId });

// A tiny in-memory stand-in for the job_summaries table, backing the mocked
// db/summaries module so saveSummaryRecord/getSummaryRecord round-trip realistically
// across a test (needed for the persist-before-render and rerender-recovers tests).
let summaryStore: Map<string, FakeSummaryRecord>;

beforeEach(() => {
  vi.resetAllMocks(); mocks.handlers.clear(); pendingPersist.clear();
  summaryStore = new Map();
  mocks.getJob.mockReturnValue({ id: 'job', title: 'Conseil', status: 'done' });
  mocks.getTranscript.mockReturnValue([{ id: 'turn', job_id: 'job', speaker_label: 'Speaker 1',
    chunk_index: 0, start_ms: 65000, end_ms: 70000, text: 'Correction actuelle', original_text: 'Ancien texte' }]);
  mocks.getSpeakerMappings.mockReturnValue([{ chunk_index: 0, speaker_label: 'Speaker 1', display_name: 'Alice' }]);
  mocks.getSecretPlaintext.mockReturnValue('test-placeholder');
  mocks.getPreference.mockReturnValue(DEFAULT_PRICING_RATES);
  mocks.showSaveDialog.mockResolvedValue({ canceled: false, filePath: 'C:\\exports\\summary.docx' });
  mocks.generateSummary.mockResolvedValue({ topics: [] });
  mocks.renderSummaryDocx.mockResolvedValue(Buffer.from('docx bytes'));
  mocks.writeFile.mockResolvedValue(undefined); mocks.openPath.mockResolvedValue('');
  mocks.rename.mockResolvedValue(undefined); mocks.rm.mockResolvedValue(undefined);
  mocks.saveSummaryRecord.mockImplementation((jobId: string, summaryJson: string, transcript: string) => {
    summaryStore.set(jobId, { job_id: jobId, summary_json: summaryJson, transcript_snapshot: transcript, created_at: Date.now() });
  });
  mocks.getSummaryRecord.mockImplementation((jobId: string) => summaryStore.get(jobId) ?? null);
  registerSummaryHandlers();
});

describe('summary export IPC', () => {
  it('generates from committed corrections and names, saves, then opens only the saved path', async () => {
    expect(await open()).toEqual({ opened: false });
    expect(await run()).toEqual({ status: 'saved', filePath: 'C:\\exports\\summary.docx' });
    expect(mocks.generateSummary).toHaveBeenCalledWith('[00:01:05] Alice: Correction actuelle', 'test-placeholder', 70000,
      expect.objectContaining({ onUsage: expect.any(Function) }));
    // Written to a sibling temp file first, then moved into place, so a failure
    // part-way through cannot truncate the document already at that path.
    expect(mocks.writeFile).toHaveBeenCalledWith(expect.stringContaining('.summary.docx.'), Buffer.from('docx bytes'));
    expect(mocks.writeFile).not.toHaveBeenCalledWith('C:\\exports\\summary.docx', expect.anything());
    expect(mocks.rename).toHaveBeenCalledWith(expect.stringContaining('.tmp'), 'C:\\exports\\summary.docx');
    expect(await open()).toEqual({ opened: true });
    expect(mocks.openPath).toHaveBeenCalledWith('C:\\exports\\summary.docx');
    expect(await open('C:\\untrusted.exe')).toEqual({ opened: false });
  });
  it('cancels before the paid request', async () => {
    mocks.showSaveDialog.mockResolvedValue({ canceled: true });
    expect(await run()).toEqual({ status: 'canceled' });
    expect(mocks.generateSummary).not.toHaveBeenCalled(); expect(mocks.writeFile).not.toHaveBeenCalled();
  });
  it.each(['empty_transcript', 'missing_key'])('reports %s before showing the dialog', async kind => {
    if (kind === 'empty_transcript') mocks.getTranscript.mockReturnValue([]);
    else mocks.getSecretPlaintext.mockReturnValue(null);
    expect(await run()).toEqual({ status: 'error', error: kind });
    expect(mocks.showSaveDialog).not.toHaveBeenCalled(); expect(mocks.generateSummary).not.toHaveBeenCalled();
  });
  it('rejects unfinished jobs and misleading extensions', async () => {
    mocks.getJob.mockReturnValue({ id: 'job', status: 'transcribing' });
    expect(await run()).toEqual({ status: 'error', error: 'empty_transcript' });
    mocks.getJob.mockReturnValue({ id: 'job', title: 'Conseil', status: 'done' });
    mocks.showSaveDialog.mockResolvedValue({ canceled: false, filePath: 'C:\\exports\\document.exe' });
    // Caught before the request, so the wrong-extension message must not imply a charge.
    expect(await run()).toEqual({ status: 'error', error: 'bad_extension' });
    expect(mocks.generateSummary).not.toHaveBeenCalled();
  });
  it('rejects duplicate generation while the first request is pending', async () => {
    let finish!: (value: object) => void;
    mocks.generateSummary.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const first = run();
    await vi.waitFor(() => expect(mocks.generateSummary).toHaveBeenCalledTimes(1));
    expect(await run()).toEqual({ status: 'error', error: 'busy' });
    finish({ topics: [] }); await first;
  });
  it('does not save invalid output, releases the busy flag, and allows a retry', async () => {
    mocks.generateSummary.mockRejectedValueOnce(new SummaryError('invalid_summary'));
    expect(await run()).toEqual({ status: 'error', error: 'invalid_summary' });
    expect(mocks.writeFile).not.toHaveBeenCalled();
    expect((await run()).status).toBe('saved');
  });
  it('reports write and open failures without claiming success', async () => {
    mocks.writeFile.mockRejectedValueOnce(new Error('private OS details'));
    expect(await run()).toEqual({ status: 'error', error: 'save_failed' });
    expect(await open()).toEqual({ opened: false });
    await run(); mocks.openPath.mockResolvedValue('no associated app');
    expect(await open()).toEqual({ opened: false });
  });

  it('keeps a persisted record when the write fails, and rerenders/re-saves it without paying again', async () => {
    mocks.writeFile.mockRejectedValueOnce(new Error('file is open in Word'));
    expect(await run()).toEqual({ status: 'error', error: 'save_failed' });
    // The record was already persisted (before the write was ever attempted), so the
    // Régénérer affordance is available even though this generation's write failed.
    expect(await state()).toEqual({ filePath: null, hasStoredSummary: true, busy: false });
    expect(mocks.generateSummary).toHaveBeenCalledTimes(1);

    mocks.showSaveDialog.mockResolvedValue({ canceled: false, filePath: 'C:\\exports\\ailleurs.docx' });
    expect(await rerender()).toEqual({ status: 'saved', filePath: 'C:\\exports\\ailleurs.docx' });
    // The stored record was reused: no second provider request was made.
    expect(mocks.generateSummary).toHaveBeenCalledTimes(1);
    expect(mocks.rename).toHaveBeenCalledWith(expect.stringContaining('.tmp'), 'C:\\exports\\ailleurs.docx');
    expect(await open()).toEqual({ opened: true });
    expect(await state()).toEqual({ filePath: 'C:\\exports\\ailleurs.docx', hasStoredSummary: true, busy: false });

    mocks.showSaveDialog.mockResolvedValue({ canceled: true });
    expect(await rerender()).toEqual({ status: 'error', error: 'save_failed' });
  });

  it('separates a local rendering fault from a provider failure', async () => {
    mocks.renderSummaryDocx.mockRejectedValueOnce(new Error('docx internals'));
    // The request was billed, so this must not be reported as a provider problem.
    expect(await run()).toEqual({ status: 'error', error: 'render_failed' });
    expect(mocks.writeFile).not.toHaveBeenCalled();
    // Persistence happens before rendering, so the record survives a render failure.
    expect(mocks.saveSummaryRecord).toHaveBeenCalledTimes(1);
    expect(await state()).toEqual({ filePath: null, hasStoredSummary: true, busy: false });
  });

  it('cleans up the temporary file when the move into place fails', async () => {
    mocks.rename.mockRejectedValueOnce(new Error('destination locked'));
    expect(await run()).toEqual({ status: 'error', error: 'save_failed' });
    expect(mocks.rm).toHaveBeenCalledWith(expect.stringContaining('.tmp'), { force: true });
  });

  describe('summary:rerender', () => {
    it('returns no_stored_summary when nothing was ever persisted for this job', async () => {
      expect(await rerender()).toEqual({ status: 'error', error: 'no_stored_summary' });
      expect(mocks.renderSummaryDocx).not.toHaveBeenCalled();
    });

    it('reports a render failure from stored (possibly corrupt) data without touching the provider', async () => {
      mocks.getSummaryRecord.mockReturnValue({ job_id: 'job', summary_json: JSON.stringify({ topics: [] }), transcript_snapshot: 'snap', created_at: Date.now() });
      mocks.renderSummaryDocx.mockRejectedValueOnce(new Error('docx internals'));
      expect(await rerender()).toEqual({ status: 'error', error: 'render_failed' });
      expect(mocks.generateSummary).not.toHaveBeenCalled();
    });

    it('retries a newer, still-unsaved pendingPersist entry even when an older record already exists, instead of silently dropping it', async () => {
      // An older generation is already durable...
      summaryStore.set('job', { job_id: 'job', summary_json: JSON.stringify({ topics: ['old'] }), transcript_snapshot: 'old transcript', created_at: Date.now() });
      // ...but a newer, already-paid-for generation's saveSummaryRecord failed and is
      // still sitting in the fallback. Comparing against `!record` alone would treat
      // the older record as "already saved" and drop this newer content unsaved.
      pendingPersist.set('job', { summaryJson: JSON.stringify({ topics: ['new'] }), transcript: 'new transcript' });
      expect(await rerender()).toEqual({ status: 'saved', filePath: 'C:\\exports\\summary.docx' });
      // The newer content was actually persisted (an upsert, replacing the older
      // record per SC-8), not merely discarded from pendingPersist.
      expect(mocks.saveSummaryRecord).toHaveBeenCalledWith('job', JSON.stringify({ topics: ['new'] }), 'new transcript');
      expect(mocks.renderSummaryDocx).toHaveBeenCalledWith({ topics: ['new'] }, 'new transcript');
      expect(pendingPersist.has('job')).toBe(false);
    });

    it('reports persist_failed — not no_stored_summary — when the pendingPersist retry itself fails, and keeps the entry recoverable', async () => {
      // Seeds the narrow session-only fallback directly, as if an earlier
      // 'summary:generate' had already hit persist_failed for this job.
      pendingPersist.set('job', { summaryJson: JSON.stringify({ topics: [] }), transcript: 'stored transcript' });
      mocks.saveSummaryRecord.mockImplementationOnce(() => { throw new Error('disk still full'); });
      // The same underlying DB issue hasn't cleared, so the retry also fails. This
      // must not fall through to 'no_stored_summary' — the paid result is still
      // sitting in pendingPersist, so that would misleadingly claim nothing was ever
      // generated and could invite a needless, real, paid re-generation.
      expect(await rerender()).toEqual({ status: 'error', error: 'persist_failed' });
      expect(mocks.renderSummaryDocx).not.toHaveBeenCalled();
      // Never cleared on this failure path — still recoverable on a later attempt.
      expect(pendingPersist.get('job')).toEqual({ summaryJson: JSON.stringify({ topics: [] }), transcript: 'stored transcript' });
    });

    it('maps an unexpected local error outside the persist/render try-catches to rerender_failed, never provider_error, and still releases the busy flag', async () => {
      // Neither of the two inner try/catches (persist-retry, render) covers a
      // getSummaryRecord throw — it happens before either of them runs.
      mocks.getSummaryRecord.mockImplementationOnce(() => { throw new Error('sqlite busy'); });
      expect(await rerender()).toEqual({ status: 'error', error: 'rerender_failed' });
      expect(mocks.renderSummaryDocx).not.toHaveBeenCalled();
      // The busy guard must still be released so a later call proceeds normally.
      mocks.getSummaryRecord.mockReturnValue({ job_id: 'job', summary_json: JSON.stringify({ topics: [] }), transcript_snapshot: 'snap', created_at: Date.now() });
      expect(await rerender()).toEqual({ status: 'saved', filePath: 'C:\\exports\\summary.docx' });
    });
  });

  describe('busy guard shared between summary:generate and summary:rerender', () => {
    it('a concurrent rerender cannot run while a generate is in flight for the same job', async () => {
      let finish!: (value: object) => void;
      mocks.generateSummary.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
      const first = run();
      await vi.waitFor(() => expect(mocks.generateSummary).toHaveBeenCalledTimes(1));
      expect(await rerender()).toEqual({ status: 'error', error: 'busy' });
      finish({ topics: [] }); await first;
    });

    it('a concurrent generate cannot run while a rerender is in flight for the same job', async () => {
      mocks.getSummaryRecord.mockReturnValue({ job_id: 'job', summary_json: JSON.stringify({ topics: [] }), transcript_snapshot: 'snap', created_at: Date.now() });
      let finishRender!: (value: Buffer) => void;
      mocks.renderSummaryDocx.mockImplementation(() => new Promise(resolve => { finishRender = resolve; }));
      const first = rerender();
      await vi.waitFor(() => expect(mocks.renderSummaryDocx).toHaveBeenCalledTimes(1));
      expect(await run()).toEqual({ status: 'error', error: 'busy' });
      finishRender(Buffer.from('docx bytes')); await first;
    });

    // Regression for the missing `await` on 'summary:rerender's final
    // `return save(...)`: the test above only holds renderSummaryDocx() open, so
    // it never exercises the save-dialog/write phase and would pass even with
    // the bug present (a bare `return save(...)` still blocks a concurrent call
    // that arrives before save() is even invoked). This test instead holds the
    // save DIALOG open — the phase the bug actually reopens the race for — so it
    // fails against the pre-fix code (busy flips back to false as soon as
    // save() is called, not once its dialog+write finish) and passes once
    // 'summary:rerender' does `return await save(...)`.
    it('a concurrent generate cannot run while a rerender\u2019s save dialog is still open (Fix 1 regression)', async () => {
      mocks.getSummaryRecord.mockReturnValue({ job_id: 'job', summary_json: JSON.stringify({ topics: [] }), transcript_snapshot: 'snap', created_at: Date.now() });
      let finishDialog!: (value: { canceled: boolean; filePath?: string }) => void;
      // mockImplementationOnce (not mockImplementation): only the rerender's own
      // dialog call should hang. A concurrent generate's own dialog call, if it
      // were ever wrongly allowed to run, must fall back to the default resolved
      // mock rather than also hanging — otherwise a pre-fix failure would show up
      // as a timeout instead of the intended busy-flag mismatch.
      mocks.showSaveDialog.mockImplementationOnce(() => new Promise(resolve => { finishDialog = resolve; }));
      const first = rerender();
      await vi.waitFor(() => expect(mocks.showSaveDialog).toHaveBeenCalledTimes(1));
      // The rerender's save dialog is still open here. Pre-fix, 'summary:state'
      // already reports busy: false at this point.
      expect((await state()).busy).toBe(true);
      expect(await run()).toEqual({ status: 'error', error: 'busy' });
      finishDialog({ canceled: false, filePath: 'C:\\exports\\summary.docx' });
      await first;
    });
  });

  describe('a later failed save must not resurface an earlier success (Fix 2 regression)', () => {
    it('clears the stale saved path when a second generate for the same job fails to write', async () => {
      expect(await run()).toEqual({ status: 'saved', filePath: 'C:\\exports\\summary.docx' });
      mocks.writeFile.mockRejectedValueOnce(new Error('disk full'));
      expect(await run()).toEqual({ status: 'error', error: 'save_failed' });
      // Before the fix, 'savedPaths' kept the FIRST generation's path forever,
      // so 'summary:state' would still report it here — as if this second,
      // failed (but already-billed) attempt had actually succeeded — and
      // 'summary:open' would open that stale file instead of the truly latest,
      // already-persisted job_summaries content.
      expect(await state()).toEqual({ filePath: null, hasStoredSummary: true, busy: false });
      expect(await open()).toEqual({ opened: false });
    });

    it('clears the stale saved path when a rerender\u2019s save dialog is cancelled', async () => {
      expect(await run()).toEqual({ status: 'saved', filePath: 'C:\\exports\\summary.docx' });
      mocks.showSaveDialog.mockResolvedValueOnce({ canceled: true });
      expect(await rerender()).toEqual({ status: 'error', error: 'save_failed' });
      expect(await state()).toEqual({ filePath: null, hasStoredSummary: true, busy: false });
    });
  });

  describe('persist_failed and the pendingPersist recovery fallback', () => {
    it('reports persist_failed (not provider_error) after a paid call, and rerender recovers it without a new request', async () => {
      mocks.saveSummaryRecord.mockImplementationOnce(() => { throw new Error('disk full'); });
      expect(await run()).toEqual({ status: 'error', error: 'persist_failed' });
      expect(mocks.generateSummary).toHaveBeenCalledTimes(1);
      // Not yet durably persisted, but the session-only fallback keeps it recoverable —
      // summary:state's hasStoredSummary reflects that.
      expect(pendingPersist.get('job')).toEqual({ summaryJson: JSON.stringify({ topics: [] }), transcript: '[00:01:05] Alice: Correction actuelle' });
      expect(await state()).toEqual({ filePath: null, hasStoredSummary: true, busy: false });

      mocks.showSaveDialog.mockResolvedValue({ canceled: false, filePath: 'C:\\exports\\recovered.docx' });
      expect(await rerender()).toEqual({ status: 'saved', filePath: 'C:\\exports\\recovered.docx' });
      // Recovered from the in-memory fallback, not from a fresh, second paid request.
      expect(mocks.generateSummary).toHaveBeenCalledTimes(1);
      expect(pendingPersist.has('job')).toBe(false);
      expect(mocks.getSummaryRecord('job')).not.toBeNull();
    });
  });

  describe('cost recovery when updateJobCost fails after a successful saveSummaryRecord', () => {
    it('does not report persist_failed when only the cost write fails, and a later rerender applies the recovered cost exactly once', async () => {
      mocks.generateSummary.mockImplementation(async (_t: string, _k: string, _d: number, opts: { onUsage?: (u: unknown) => void }) => {
        opts.onUsage?.({ input_tokens: 1_000_000, output_tokens: 500_000, input_tokens_details: { cached_tokens: 0 } });
        return { topics: [] };
      });
      mocks.updateJobCost.mockImplementationOnce(() => { throw new Error('db locked'); });
      // The record IS saved — only the cost bookkeeping failed — so the generation
      // must still be reported as succeeding through to the render/write step, not
      // as persist_failed (whose text wrongly implies the record was never saved and
      // would invite an unnecessary real re-bill).
      expect(await run()).toEqual({ status: 'saved', filePath: 'C:\\exports\\summary.docx' });
      expect(mocks.saveSummaryRecord).toHaveBeenCalledTimes(1);
      expect(pendingPersist.get('job')).toEqual({
        summaryJson: JSON.stringify({ topics: [] }),
        transcript: '[00:01:05] Alice: Correction actuelle',
        costUsd: 14,
      });

      // A later rerender (no new provider request) recovers the stuck cost and
      // applies it exactly once, then clears it so it can never be double-applied.
      expect(await rerender()).toEqual({ status: 'saved', filePath: 'C:\\exports\\summary.docx' });
      expect(mocks.generateSummary).toHaveBeenCalledTimes(1);
      expect(mocks.updateJobCost).toHaveBeenCalledTimes(2);
      expect(mocks.updateJobCost).toHaveBeenNthCalledWith(2, 'job', 14);
      expect(pendingPersist.has('job')).toBe(false);
    });
  });

  describe('summary cost computation', () => {
    it('computes and accumulates the real summary cost from a well-formed usage payload across two generations', async () => {
      mocks.generateSummary.mockImplementation(async (_t: string, _k: string, _d: number, opts: { onUsage?: (u: unknown) => void }) => {
        opts.onUsage?.({ input_tokens: 1_000_000, output_tokens: 500_000, input_tokens_details: { cached_tokens: 0 } });
        return { topics: [] };
      });
      // DEFAULT_PRICING_RATES.openaiSummary: 4.00/output... input 4.00/M, output 20.00/M.
      // cost = 1,000,000/1e6*4.00 + 500,000/1e6*20.00 = 4 + 10 = 14
      expect((await run()).status).toBe('saved');
      expect(mocks.updateJobCost).toHaveBeenNthCalledWith(1, 'job', 14);

      expect((await run()).status).toBe('saved');
      expect(mocks.updateJobCost).toHaveBeenCalledTimes(2);
      expect(mocks.updateJobCost).toHaveBeenNthCalledWith(2, 'job', 14);
    });

    it('does not update cost when the usage shape cannot be parsed', async () => {
      mocks.generateSummary.mockImplementation(async (_t: string, _k: string, _d: number, opts: { onUsage?: (u: unknown) => void }) => {
        opts.onUsage?.({ unexpected: 'shape' });
        return { topics: [] };
      });
      expect((await run()).status).toBe('saved');
      expect(mocks.updateJobCost).not.toHaveBeenCalled();
    });

    it('does not update cost when no usage is ever reported', async () => {
      // Default mock never calls onUsage at all.
      expect((await run()).status).toBe('saved');
      expect(mocks.updateJobCost).not.toHaveBeenCalled();
    });
  });
});
