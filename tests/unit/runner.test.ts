import { describe, it, expect, vi, beforeEach } from 'vitest';

// Hoist mocks so they are applied before any module import.
vi.mock('../../src/main/db/jobs', () => ({
  createJob: vi.fn(),
  updateJobStatus: vi.fn(),
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
  getPreference: vi.fn(() => 'C:/Users/test/Documents/MeetingTranscriber'),
}));
vi.mock('electron', () => ({
  BrowserWindow: { getAllWindows: vi.fn(() => []) },
}));
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
    });

    const saved = vi.mocked(saveTranscript).mock.calls[0][0] as Array<{ speaker_label: string }>;
    expect(saved).toHaveLength(1);
    expect(saved[0].speaker_label).toBe('Speaker A'); // No chunk prefix
  });
});
