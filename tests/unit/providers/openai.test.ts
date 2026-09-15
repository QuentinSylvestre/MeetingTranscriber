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

  it('uses gpt-4o-transcribe-diarize with diarized_json and chunking_strategy=auto', async () => {
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

    const body = mockFetch.mock.calls[0][1].body as FormData;
    expect(body.get('model')).toBe('gpt-4o-transcribe-diarize');
    expect(body.get('response_format')).toBe('diarized_json');
    expect(body.get('chunking_strategy')).toBe('auto');
    // language param must not be sent (unsupported by this model)
    expect(body.get('language')).toBeNull();
  });

  it('throws a clear error on 403 — no fallback', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 403,
      text: async () => JSON.stringify({ error: { message: 'Project does not have access to model' } }),
    });

    await expect(
      provider.transcribeFile('/fake/audio.mp3', { language: 'en', diarize: true }, () => {}, new AbortController().signal)
    ).rejects.toThrow(/does not have access to gpt-4o-transcribe-diarize/);

    // Must not make a second request (no silent fallback)
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('throws when diarize is false — diarization is required', async () => {
    await expect(
      provider.transcribeFile('/fake/audio.mp3', { language: 'en', diarize: false }, () => {}, new AbortController().signal)
    ).rejects.toThrow('OpenAI provider requires diarize: true');

    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('returns plain Speaker labels (runner applies Chunk N prefix)', async () => {
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

    expect(results[0].turns[0].speakerLabel).toBe('Speaker 0');
  });

  it('falls back to Speaker 0 when speaker field is absent in diarized response', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
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

  it('throws on non-403 HTTP errors', async () => {
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
      { language: 'en', diarize: true },
      () => {},
      new AbortController().signal
    );

    expect(results[0].turns).toHaveLength(0);
  });
});
