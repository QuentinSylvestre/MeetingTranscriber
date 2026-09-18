import { describe, it, expect, vi, beforeEach } from 'vitest';

// vi.hoisted: vi.mock factories below are hoisted above imports, so any fixture
// data they reference must come from vi.hoisted rather than a plain top-level
// const (which would not yet be initialized when the factory runs).
const { TEST_PRICING_RATES, TEST_RECORDINGS_FOLDER } = vi.hoisted(() => ({
  // Mirrors shared/ipc-types.ts's DEFAULT_PRICING_RATES — a self-contained test
  // fixture, not a re-export, so this suite doesn't depend on production defaults
  // changing out from under it.
  TEST_PRICING_RATES: {
    assemblyai: { universal35ProPerHourUsd: 0.21, universal2PerHourUsd: 0.15, diarizationPerHourUsd: 0.02 },
    elevenlabs: { perHourUsd: 0.22 },
    openaiTranscribe: { inputPerMillionUsd: 2.50, outputPerMillionUsd: 10.00 },
    openaiSummary: { inputPerMillionUsd: 4.00, outputPerMillionUsd: 20.00, cachedInputPerMillionUsd: 0.40 },
    google: { inputPerMillionUsd: 2.00, outputPerMillionUsd: 12.00 },
  },
  TEST_RECORDINGS_FOLDER: 'C:/Users/test/Documents/MeetingTranscriber',
}));

// Hoist mocks so they are applied before any module import.
vi.mock('../../src/main/db/jobs', () => ({
  createJob: vi.fn(),
  updateJobStatus: vi.fn(),
  updateJobCost: vi.fn(),
}));
vi.mock('../../src/main/db/transcript', () => ({
  saveTranscript: vi.fn(),
}));
vi.mock('../../src/main/chunker/index', () => ({
  chunkAudio: vi.fn(),
}));
vi.mock('../../src/main/providers/index', () => ({
  getProvider: vi.fn(),
}));
vi.mock('../../src/main/settings/store', () => ({
  getPreference: vi.fn((key: string) =>
    key === 'pricingRates' ? TEST_PRICING_RATES : TEST_RECORDINGS_FOLDER
  ),
}));
vi.mock('electron', () => {
  // Created once per fresh module registry (vi.resetModules() in beforeEach forces
  // a fresh factory run) and returned by every getAllWindows() call within that
  // lifetime, so webContents.send's call history accumulates across an entire
  // startJob() run instead of resetting on every sendProgress() call.
  const win = { isDestroyed: () => false, webContents: { send: vi.fn() } };
  return { BrowserWindow: { getAllWindows: vi.fn(() => [win]) } };
});
vi.mock('electron-log', () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));
vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  return {
    ...actual,
    unlinkSync: vi.fn(),
    rmSync: vi.fn(),
  };
});

// Reads back the accumulated transcription:progress payloads sent so far in the
// current module lifetime, via the fake window installed by the 'electron' mock above.
async function getProgressPayloads(): Promise<Array<{ jobId: string; status: string; costUsd?: number }>> {
  const { BrowserWindow } = await import('electron');
  const win = BrowserWindow.getAllWindows()[0] as unknown as { webContents: { send: ReturnType<typeof vi.fn> } };
  return win.webContents.send.mock.calls.map(call => call[1]);
}

// Reset module registry before each test so _activeJobId is cleared between runs.
beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
});

describe('runner chunk prefix logic', () => {
  it('prefixes speaker labels with "Chunk N – " for multi-chunk jobs', async () => {
    const { chunkAudio } = await import('../../src/main/chunker/index');
    const { getProvider } = await import('../../src/main/providers/index');
    const { saveTranscript } = await import('../../src/main/db/transcript');

    // Two chunks returned — triggers needsChunkPrefix = true
    vi.mocked(chunkAudio).mockResolvedValue({
      paths: ['chunk_000.mp3', 'chunk_001.mp3'],
      chunkDurationMs: 1000 * 1000, // 1000 seconds per chunk
    });

    const mockAdapter = {
      name: 'openai',
      transcribeFile: vi.fn().mockImplementation((_filePath: string, _opts: unknown, onProgress: (s: string) => void) => {
        onProgress('done');
        return Promise.resolve([
          { chunkIndex: 0, turns: [{ speakerLabel: 'Speaker 0', startMs: 0, endMs: 1000, text: 'Hello' }] },
        ]);
      }),
    };
    vi.mocked(getProvider).mockReturnValue(mockAdapter as ReturnType<typeof getProvider>);

    const { startJob } = await import('../../src/main/transcription/runner');
    await startJob({
      jobId: 'test-prefix-job',
      title: 'Test',
      audioPath: 'C:/Users/test/Documents/MeetingTranscriber/test.mp3',
      provider: 'openai',
      model: 'gpt-4o-transcribe-diarize',
      language: 'fr',
    });

    const saved = vi.mocked(saveTranscript).mock.calls[0][0] as Array<{ speaker_label: string; chunk_index: number }>;
    // Both chunks return the same turn, so we expect two entries
    expect(saved).toHaveLength(2);
    // Chunk 0 turn
    expect(saved[0].speaker_label).toBe('Chunk 0 \u2013 Speaker 0'); // EN-DASH
    expect(saved[0].chunk_index).toBe(0);
    // Chunk 1 turn
    expect(saved[1].speaker_label).toBe('Chunk 1 \u2013 Speaker 0'); // EN-DASH
    expect(saved[1].chunk_index).toBe(1);
  });

  it('does NOT prefix for single-chunk jobs (AssemblyAI)', async () => {
    const { chunkAudio } = await import('../../src/main/chunker/index');
    const { getProvider } = await import('../../src/main/providers/index');
    const { saveTranscript } = await import('../../src/main/db/transcript');

    // Single chunk (AssemblyAI pass-through) — triggers needsChunkPrefix = false
    vi.mocked(chunkAudio).mockResolvedValue({
      paths: ['C:/Users/test/Documents/MeetingTranscriber/test.mp3'],
      chunkDurationMs: Infinity,
    });

    const mockAdapter = {
      name: 'assemblyai',
      transcribeFile: vi.fn().mockResolvedValue([
        { chunkIndex: 0, turns: [{ speakerLabel: 'Speaker A', startMs: 0, endMs: 1000, text: 'Hi' }] },
      ]),
    };
    vi.mocked(getProvider).mockReturnValue(mockAdapter as ReturnType<typeof getProvider>);

    const { startJob } = await import('../../src/main/transcription/runner');
    await startJob({
      jobId: 'test-single-job',
      title: 'Test Single',
      audioPath: 'C:/Users/test/Documents/MeetingTranscriber/test.mp3',
      provider: 'assemblyai',
      model: 'universal',
      language: 'fr',
      speakerCountHint: { mode: 'exact', count: 4 },
    });

    const saved = vi.mocked(saveTranscript).mock.calls[0][0] as Array<{ speaker_label: string }>;
    expect(saved).toHaveLength(1);
    expect(saved[0].speaker_label).toBe('Speaker A'); // No chunk prefix

    const transcribeOpts = mockAdapter.transcribeFile.mock.calls[0][1] as { speakerCountHint?: unknown };
    expect(transcribeOpts.speakerCountHint).toEqual({ mode: 'exact', count: 4 });
  });
});

describe('runner cost/duration bookkeeping', () => {
  it('accumulates cost per chunk and streams the running total via sendProgress', async () => {
    const { chunkAudio } = await import('../../src/main/chunker/index');
    const { getProvider } = await import('../../src/main/providers/index');
    const { updateJobCost, updateJobStatus } = await import('../../src/main/db/jobs');

    vi.mocked(chunkAudio).mockResolvedValue({
      paths: ['chunk_000.mp3', 'chunk_001.mp3'],
      chunkDurationMs: 1000 * 1000,
    });

    const mockAdapter = {
      name: 'google',
      transcribeFile: vi.fn()
        .mockImplementationOnce(() => Promise.resolve([
          { chunkIndex: 0, turns: [{ speakerLabel: 'Speaker 0', startMs: 0, endMs: 1000, text: 'Hello' }],
            usage: { kind: 'tokens', inputTokens: 1_000_000, outputTokens: 200_000 } },
        ]))
        .mockImplementationOnce(() => Promise.resolve([
          { chunkIndex: 0, turns: [{ speakerLabel: 'Speaker 0', startMs: 0, endMs: 1000, text: 'World' }],
            usage: { kind: 'tokens', inputTokens: 500_000, outputTokens: 50_000 } },
        ])),
    };
    vi.mocked(getProvider).mockReturnValue(mockAdapter as ReturnType<typeof getProvider>);

    const { startJob } = await import('../../src/main/transcription/runner');
    await startJob({
      jobId: 'test-cost-multi',
      title: 'Test Multi Cost',
      audioPath: 'C:/Users/test/Documents/MeetingTranscriber/test.mp3',
      provider: 'google',
      model: 'default',
      language: 'fr',
    });

    // Hand-computed from TEST_PRICING_RATES.google (input $2/M, output $12/M):
    // chunk0: (1,000,000/1e6)*2.00 + (200,000/1e6)*12.00 = 2.00 + 2.40 = 4.40
    // chunk1: (500,000/1e6)*2.00  + (50,000/1e6)*12.00  = 1.00 + 0.60 = 1.60
    expect(vi.mocked(updateJobCost).mock.calls).toEqual([
      ['test-cost-multi', 4.4],
      ['test-cost-multi', 1.6],
    ]);

    // google usage is always 'tokens', never 'duration' — duration_s must never be
    // touched by this job (no updateJobStatus call carries a defined 4th argument).
    expect(vi.mocked(updateJobStatus).mock.calls.some(call => call[3] !== undefined)).toBe(false);

    const payloads = await getProgressPayloads();
    const costPayloads = payloads.filter(p => p.costUsd !== undefined);
    expect(costPayloads.map(p => p.costUsd)).toEqual([4.4, 6]); // cumulative: 4.40, then 4.40+1.60

    // Every payload sent before the first chunk's cost is known must omit costUsd
    // entirely (undefined) — never send a computed $0.
    const firstCostIndex = payloads.findIndex(p => p.costUsd !== undefined);
    expect(firstCostIndex).toBeGreaterThan(0);
    for (const p of payloads.slice(0, firstCostIndex)) {
      expect(p.costUsd).toBeUndefined();
    }
  });

  it("populates duration_s from a single-shot provider's real duration usage", async () => {
    const { chunkAudio } = await import('../../src/main/chunker/index');
    const { getProvider } = await import('../../src/main/providers/index');
    const { updateJobCost, updateJobStatus } = await import('../../src/main/db/jobs');

    vi.mocked(chunkAudio).mockResolvedValue({
      paths: ['C:/Users/test/Documents/MeetingTranscriber/test.mp3'],
      chunkDurationMs: Infinity,
    });

    const mockAdapter = {
      name: 'assemblyai',
      transcribeFile: vi.fn().mockResolvedValue([
        { chunkIndex: 0, turns: [{ speakerLabel: 'Speaker A', startMs: 0, endMs: 1000, text: 'Hi' }],
          usage: { kind: 'duration', seconds: 3600, modelUsed: 'universal-3-5-pro' } },
      ]),
    };
    vi.mocked(getProvider).mockReturnValue(mockAdapter as ReturnType<typeof getProvider>);

    const { startJob } = await import('../../src/main/transcription/runner');
    await startJob({
      jobId: 'test-cost-single',
      title: 'Test Single Cost',
      audioPath: 'C:/Users/test/Documents/MeetingTranscriber/test.mp3',
      provider: 'assemblyai',
      model: 'universal',
      language: 'fr',
    });

    // Hand-computed from TEST_PRICING_RATES.assemblyai: modelUsed doesn't contain
    // 'universal-2', so it bills at the Pro tier: (3600/3600)*(0.21+0.02) = 0.23.
    const expectedCost = (3600 / 3600) * (0.21 + 0.02);
    expect(vi.mocked(updateJobCost).mock.calls).toEqual([['test-cost-single', expectedCost]]);

    // duration_s is written mid-loop the moment the real duration is known...
    expect(vi.mocked(updateJobStatus).mock.calls).toContainEqual(['test-cost-single', 'transcribing', null, 3600]);
    // ...and the job's completion write carries the same real value through rather
    // than stomping it back to unknown.
    expect(vi.mocked(updateJobStatus).mock.calls.at(-1)).toEqual(['test-cost-single', 'done', null, 3600]);
  });

  it('isolates a cost-bookkeeping failure from turn-saving — the job still completes', async () => {
    const { chunkAudio } = await import('../../src/main/chunker/index');
    const { getProvider } = await import('../../src/main/providers/index');
    const { updateJobCost, updateJobStatus } = await import('../../src/main/db/jobs');
    const { saveTranscript } = await import('../../src/main/db/transcript');
    const log = (await import('electron-log')).default;

    vi.mocked(updateJobCost).mockImplementationOnce(() => { throw new Error('SQLITE_BUSY'); });

    vi.mocked(chunkAudio).mockResolvedValue({
      paths: ['C:/Users/test/Documents/MeetingTranscriber/test.mp3'],
      chunkDurationMs: Infinity,
    });

    const mockAdapter = {
      name: 'assemblyai',
      transcribeFile: vi.fn().mockResolvedValue([
        { chunkIndex: 0, turns: [{ speakerLabel: 'Speaker A', startMs: 0, endMs: 1000, text: 'Hi' }],
          usage: { kind: 'duration', seconds: 3600, modelUsed: 'universal-3-5-pro' } },
      ]),
    };
    vi.mocked(getProvider).mockReturnValue(mockAdapter as ReturnType<typeof getProvider>);

    const { startJob } = await import('../../src/main/transcription/runner');
    await startJob({
      jobId: 'test-cost-throw',
      title: 'Test Cost Throw',
      audioPath: 'C:/Users/test/Documents/MeetingTranscriber/test.mp3',
      provider: 'assemblyai',
      model: 'universal',
      language: 'fr',
    });

    // The turn was fetched (and paid for) before the throw — it must still be saved.
    const saved = vi.mocked(saveTranscript).mock.calls[0][0] as Array<{ speaker_label: string }>;
    expect(saved).toHaveLength(1);
    // The job completes normally despite the cost-write failure.
    expect(vi.mocked(updateJobStatus).mock.calls.at(-1)?.[1]).toBe('done');
    expect(log.warn).toHaveBeenCalledWith(expect.stringContaining('cost bookkeeping failed'));
  });

  it('keeps chunk-0 cost recorded when a multi-chunk job is cancelled before chunk 1', async () => {
    const { chunkAudio } = await import('../../src/main/chunker/index');
    const { getProvider } = await import('../../src/main/providers/index');
    const { updateJobCost, updateJobStatus } = await import('../../src/main/db/jobs');
    const { saveTranscript } = await import('../../src/main/db/transcript');
    const runnerModule = await import('../../src/main/transcription/runner');

    vi.mocked(chunkAudio).mockResolvedValue({
      paths: ['chunk_000.mp3', 'chunk_001.mp3'],
      chunkDurationMs: 1000 * 1000,
    });

    const mockAdapter = {
      name: 'google',
      transcribeFile: vi.fn().mockImplementation(() => {
        // Simulates the user clicking Cancel while chunk 0's request is still in
        // flight — the abort is only observed at the TOP of the next loop
        // iteration, so chunk 0's own turns/cost below are still fully processed.
        runnerModule.cancelJob();
        return Promise.resolve([
          { chunkIndex: 0, turns: [{ speakerLabel: 'Speaker 0', startMs: 0, endMs: 1000, text: 'Hello' }],
            usage: { kind: 'tokens', inputTokens: 1_000_000, outputTokens: 200_000 } },
        ]);
      }),
    };
    vi.mocked(getProvider).mockReturnValue(mockAdapter as ReturnType<typeof getProvider>);

    await runnerModule.startJob({
      jobId: 'test-cost-cancel',
      title: 'Test Cost Cancel',
      audioPath: 'C:/Users/test/Documents/MeetingTranscriber/test.mp3',
      provider: 'google',
      model: 'default',
      language: 'fr',
    });

    expect(mockAdapter.transcribeFile).toHaveBeenCalledTimes(1); // chunk 1 never started
    expect(vi.mocked(updateJobCost).mock.calls).toEqual([['test-cost-cancel', 4.4]]);
    expect(vi.mocked(updateJobStatus).mock.calls).toContainEqual(['test-cost-cancel', 'failed', 'Cancelled by user']);
    // Existing (unchanged, out-of-scope-for-this-phase) behavior: a cancelled job
    // returns before saveTranscript is ever called, so the partial transcript text
    // itself is not persisted — only its cost is, via the updateJobCost call above,
    // which runs synchronously inside the loop before the cancellation check.
    expect(saveTranscript).not.toHaveBeenCalled();

    const payloads = await getProgressPayloads();
    expect(payloads.at(-1)).toEqual({ jobId: 'test-cost-cancel', status: 'Cancelled', costUsd: undefined });
  });

  it('shows no cost anywhere when the job fails before any chunk completes', async () => {
    const { chunkAudio } = await import('../../src/main/chunker/index');
    const { getProvider } = await import('../../src/main/providers/index');
    const { updateJobCost } = await import('../../src/main/db/jobs');

    vi.mocked(chunkAudio).mockResolvedValue({
      paths: ['C:/Users/test/Documents/MeetingTranscriber/test.mp3'],
      chunkDurationMs: Infinity,
    });

    const mockAdapter = {
      name: 'assemblyai',
      transcribeFile: vi.fn().mockRejectedValue(new Error('HTTP 500')),
    };
    vi.mocked(getProvider).mockReturnValue(mockAdapter as ReturnType<typeof getProvider>);

    const { startJob } = await import('../../src/main/transcription/runner');
    await expect(startJob({
      jobId: 'test-cost-fail',
      title: 'Test Cost Fail',
      audioPath: 'C:/Users/test/Documents/MeetingTranscriber/test.mp3',
      provider: 'assemblyai',
      model: 'universal',
      language: 'fr',
    })).rejects.toThrow('HTTP 500');

    expect(updateJobCost).not.toHaveBeenCalled();
    const payloads = await getProgressPayloads();
    expect(payloads.every(p => p.costUsd === undefined)).toBe(true);
  });
});
