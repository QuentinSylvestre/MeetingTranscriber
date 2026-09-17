import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (...args: any[]) => any>(),
  getJob: vi.fn(), getTranscript: vi.fn(), getSpeakerMappings: vi.fn(), getSecretPlaintext: vi.fn(),
  showSaveDialog: vi.fn(), openPath: vi.fn(), writeFile: vi.fn(), rename: vi.fn(), rm: vi.fn(),
  generateSummary: vi.fn(), renderSummaryDocx: vi.fn(),
}));
vi.mock('electron', () => ({ ipcMain: { handle: (name: string, fn: (...args: any[]) => any) => mocks.handlers.set(name, fn) },
  BrowserWindow: { fromWebContents: () => null }, dialog: { showSaveDialog: mocks.showSaveDialog }, shell: { openPath: mocks.openPath } }));
vi.mock('fs', () => ({ promises: { writeFile: mocks.writeFile, rename: mocks.rename, rm: mocks.rm } }));
vi.mock('../../src/main/db/jobs', () => ({ getJob: mocks.getJob }));
vi.mock('../../src/main/db/transcript', () => ({ getTranscript: mocks.getTranscript, getSpeakerMappings: mocks.getSpeakerMappings }));
vi.mock('../../src/main/settings/store', () => ({ getSecretPlaintext: mocks.getSecretPlaintext }));
vi.mock('../../src/main/summary/render-docx', () => ({ renderSummaryDocx: mocks.renderSummaryDocx }));
vi.mock('../../src/main/summary/generate', async importOriginal => ({ ...await importOriginal<object>(), generateSummary: mocks.generateSummary }));
import { registerSummaryHandlers } from '../../src/main/ipc/summary';
import { SummaryError } from '../../src/main/summary/generate';

const run = () => mocks.handlers.get('summary:generate')!({ sender: {} }, { jobId: 'job' });
const retrySave = (jobId = 'job') => mocks.handlers.get('summary:retry-save')!({ sender: {} }, { jobId });
const state = (jobId = 'job') => mocks.handlers.get('summary:state')!({}, { jobId });
const open = (jobId = 'job') => mocks.handlers.get('summary:open')!({}, { jobId });

beforeEach(() => {
  vi.resetAllMocks(); mocks.handlers.clear();
  mocks.getJob.mockReturnValue({ id: 'job', title: 'Conseil', status: 'done' });
  mocks.getTranscript.mockReturnValue([{ id: 'turn', job_id: 'job', speaker_label: 'Speaker 1',
    chunk_index: 0, start_ms: 65000, end_ms: 70000, text: 'Correction actuelle', original_text: 'Ancien texte' }]);
  mocks.getSpeakerMappings.mockReturnValue([{ chunk_index: 0, speaker_label: 'Speaker 1', display_name: 'Alice' }]);
  mocks.getSecretPlaintext.mockReturnValue('test-placeholder');
  mocks.showSaveDialog.mockResolvedValue({ canceled: false, filePath: 'C:\\exports\\summary.docx' });
  mocks.generateSummary.mockResolvedValue({ topics: [] });
  mocks.renderSummaryDocx.mockResolvedValue(Buffer.from('docx bytes'));
  mocks.writeFile.mockResolvedValue(undefined); mocks.openPath.mockResolvedValue('');
  mocks.rename.mockResolvedValue(undefined); mocks.rm.mockResolvedValue(undefined);
  registerSummaryHandlers();
});

describe('summary export IPC', () => {
  it('generates from committed corrections and names, saves, then opens only the saved path', async () => {
    expect(await open()).toEqual({ opened: false });
    expect(await run()).toEqual({ status: 'saved', filePath: 'C:\\exports\\summary.docx' });
    expect(mocks.generateSummary).toHaveBeenCalledWith('[00:01:05] Alice: Correction actuelle', 'test-placeholder', 70000);
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
    expect(await run()).toEqual({ status: 'error', error: 'save_failed', canRetrySave: true });
    expect(await open()).toEqual({ opened: false });
    await run(); mocks.openPath.mockResolvedValue('no associated app');
    expect(await open()).toEqual({ opened: false });
  });

  it('keeps a paid document when the write fails and re-saves it without paying again', async () => {
    mocks.writeFile.mockRejectedValueOnce(new Error('file is open in Word'));
    expect(await run()).toEqual({ status: 'error', error: 'save_failed', canRetrySave: true });
    expect(await state()).toEqual({ filePath: null, canRetrySave: true, busy: false });
    expect(mocks.generateSummary).toHaveBeenCalledTimes(1);

    mocks.showSaveDialog.mockResolvedValue({ canceled: false, filePath: 'C:\\exports\\ailleurs.docx' });
    expect(await retrySave()).toEqual({ status: 'saved', filePath: 'C:\\exports\\ailleurs.docx' });
    // The rendered document was reused: no second provider request was made.
    expect(mocks.generateSummary).toHaveBeenCalledTimes(1);
    expect(mocks.rename).toHaveBeenCalledWith(expect.stringContaining('.tmp'), 'C:\\exports\\ailleurs.docx');
    expect(await open()).toEqual({ opened: true });
    // Once saved it is no longer pending, so the retry affordance disappears.
    expect(await state()).toEqual({ filePath: 'C:\\exports\\ailleurs.docx', canRetrySave: false, busy: false });
    expect(await retrySave()).toEqual({ status: 'error', error: 'save_failed' });
  });

  it('separates a local rendering fault from a provider failure', async () => {
    mocks.renderSummaryDocx.mockRejectedValueOnce(new Error('docx internals'));
    // The request was billed, so this must not be reported as a provider problem.
    expect(await run()).toEqual({ status: 'error', error: 'render_failed' });
    expect(mocks.writeFile).not.toHaveBeenCalled();
  });

  it('cleans up the temporary file when the move into place fails', async () => {
    mocks.rename.mockRejectedValueOnce(new Error('destination locked'));
    expect(await run()).toEqual({ status: 'error', error: 'save_failed', canRetrySave: true });
    expect(mocks.rm).toHaveBeenCalledWith(expect.stringContaining('.tmp'), { force: true });
  });
});
