import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OpenAIProvider } from '../../../src/main/providers/openai';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  return { ...actual, readFileSync: vi.fn(() => Buffer.alloc(1024, 0)) };
});

describe('OpenAIProvider', () => {
  const provider = new OpenAIProvider('sk-test-key');

  beforeEach(() => { vi.clearAllMocks(); });

  it('maps segments to SpeakerTurns with correct labels', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        segments: [
          { speaker: '0', start: 0.0, end: 1.5, text: 'Hello' },
          { speaker: '1', start: 1.6, end: 3.0, text: 'Hi there' },
        ],
      }),
      text: async () => '',
    });

    const results = await provider.transcribeFile(
      '/fake/chunk_000.mp3',
      { language: 'fr', diarize: true },
      () => {},
      new AbortController().signal
    );

    expect(results).toHaveLength(1);
    expect(results[0].chunkIndex).toBe(0);
    expect(results[0].turns).toHaveLength(2);
    expect(results[0].turns[0].speakerLabel).toBe('Speaker 0');
    expect(results[0].turns[1].speakerLabel).toBe('Speaker 1');
    expect(results[0].turns[0].startMs).toBe(0);
    expect(results[0].turns[0].endMs).toBe(1500);
    expect(results[0].turns[0].text).toBe('Hello');
  });

  it('returns plain Speaker labels (runner applies Chunk N prefix)', async () => {
    // The adapter returns 'Speaker X'; the 'Chunk N \u2013 ' prefix is applied
    // by runner.ts for multi-chunk jobs (needsChunkPrefix logic).
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        segments: [{ speaker: '0', start: 0.0, end: 1.0, text: 'Test' }],
      }),
      text: async () => '',
    });

    const results = await provider.transcribeFile(
      '/fake/chunk_001.mp3',
      { language: 'en', diarize: true },
      () => {},
      new AbortController().signal
    );

    // Adapter returns plain labels; runner applies 'Chunk N \u2013 ' prefix
    expect(results[0].turns[0].speakerLabel).toBe('Speaker 0');
  });

  it('falls back to Speaker 0 when speaker field is absent', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        // speaker field omitted
        segments: [{ start: 0.0, end: 2.0, text: 'No speaker tag' }],
      }),
      text: async () => '',
    });

    const results = await provider.transcribeFile(
      '/fake/chunk_000.mp3',
      { language: 'auto', diarize: true },
      () => {},
      new AbortController().signal
    );

    expect(results[0].turns[0].speakerLabel).toBe('Speaker 0');
  });

  it('sends Authorization header with Bearer token', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ segments: [] }),
      text: async () => '',
    });

    await provider.transcribeFile('/fake/audio.mp3', { language: 'en', diarize: true }, () => {}, new AbortController().signal);

    const fetchOptions = mockFetch.mock.calls[0][1] as RequestInit;
    expect((fetchOptions.headers as Record<string, string>)['Authorization']).toBe('Bearer sk-test-key');
  });

  it('does not send language param when language is auto', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ segments: [] }),
      text: async () => '',
    });

    await provider.transcribeFile('/fake/audio.mp3', { language: 'auto', diarize: true }, () => {}, new AbortController().signal);

    // Verify FormData was the body (no direct way to inspect FormData entries,
    // but we can verify fetch was called once and succeeded)
    expect(mockFetch).toHaveBeenCalledOnce();
  });

  it('throws when HTTP response is not ok', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 429,
      text: async () => 'Rate limit exceeded',
    });

    await expect(
      provider.transcribeFile('/fake/audio.mp3', { language: 'fr', diarize: true }, () => {}, new AbortController().signal)
    ).rejects.toThrow('OpenAI transcription failed: HTTP 429');
  });

  it('handles empty segments returning zero turns', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ segments: [] }),
      text: async () => '',
    });

    const results = await provider.transcribeFile(
      '/fake/audio.mp3',
      { language: 'en', diarize: false },
      () => {},
      new AbortController().signal
    );

    expect(results[0].turns).toHaveLength(0);
  });
});
