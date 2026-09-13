import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AssemblyAIProvider } from '../../../src/main/providers/assemblyai';

// Mock global fetch
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

// Mock fs for file buffer
vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  return {
    ...actual,
    readFileSync: vi.fn(() => Buffer.from('fake-audio-data')),
  };
});

describe('AssemblyAIProvider', () => {
  // Pass pollIntervalMs=0 so tests don't wait real time between polls
  const provider = new AssemblyAIProvider('test-api-key', 0);

  beforeEach(() => {
    mockFetch.mockReset();
  });

  it('normalizes speaker labels from A to Speaker A', async () => {
    // Mock upload
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ upload_url: 'https://cdn/audio.mp3' }) });
    // Mock create transcript
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ id: 'txid_001' }) });
    // Mock poll - first queued, then completed
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ status: 'queued' }) });
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({
      status: 'completed',
      utterances: [
        { speaker: 'A', start: 0, end: 2500, text: 'Hello' },
        { speaker: 'B', start: 2600, end: 5000, text: 'Hi there' },
      ],
    }) });

    const results = await provider.transcribeFile(
      '/fake/audio.mp3',
      { language: 'fr', diarize: true },
      () => {},
      new AbortController().signal
    );

    expect(results).toHaveLength(1);
    expect(results[0].turns[0].speakerLabel).toBe('Speaker A');
    expect(results[0].turns[1].speakerLabel).toBe('Speaker B');
    expect(results[0].turns[0].startMs).toBe(0);
    expect(results[0].turns[0].endMs).toBe(2500);
  });

  it('throws on upload failure', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 401 });
    await expect(
      provider.transcribeFile('/fake/audio.mp3', { language: 'fr', diarize: true }, () => {}, new AbortController().signal)
    ).rejects.toThrow('HTTP 401');
  });

  it('throws on transcription error status', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ upload_url: 'https://cdn/audio.mp3' }) });
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ id: 'txid_002' }) });
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ status: 'error', error: 'Audio too noisy' }) });
    await expect(
      provider.transcribeFile('/fake/audio.mp3', { language: 'en', diarize: false }, () => {}, new AbortController().signal)
    ).rejects.toThrow('Audio too noisy');
  });

  it('handles empty utterances returning zero turns', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ upload_url: 'https://cdn/audio.mp3' }) });
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ id: 'txid_003' }) });
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({
      status: 'completed',
      utterances: [],
    }) });

    const results = await provider.transcribeFile(
      '/fake/audio.mp3',
      { language: 'en', diarize: false },
      () => {},
      new AbortController().signal
    );
    expect(results[0].turns).toHaveLength(0);
    expect(results[0].chunkIndex).toBe(0);
  });

  it('returns chunkIndex 0 for single-file transcription', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ upload_url: 'https://cdn/audio.mp3' }) });
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ id: 'txid_004' }) });
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({
      status: 'completed',
      utterances: [{ speaker: 'A', start: 0, end: 1000, text: 'Test' }],
    }) });

    const results = await provider.transcribeFile(
      '/fake/audio.mp3',
      { language: 'auto', diarize: true },
      () => {},
      new AbortController().signal
    );
    expect(results[0].chunkIndex).toBe(0);
  });
});
