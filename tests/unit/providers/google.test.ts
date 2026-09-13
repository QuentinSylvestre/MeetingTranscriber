import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GoogleProvider } from '../../../src/main/providers/google';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  return {
    ...actual,
    readFileSync: vi.fn((p: unknown) => {
      // Return a large buffer for paths containing 'large' to trigger the File API path
      const pathStr = String(p);
      if (pathStr.includes('large')) {
        return Buffer.alloc(25_000_000, 0); // > 20 MB
      }
      return Buffer.alloc(1024, 0);
    }),
  };
});

describe('GoogleProvider', () => {
  const provider = new GoogleProvider('test-google-key');

  beforeEach(() => { vi.clearAllMocks(); });

  it('uses inline data for small files (< 20 MB)', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        candidates: [{
          content: { parts: [{
            text: JSON.stringify({
              utterances: [
                { speaker: 'Speaker 0', start: 0.0, end: 1.0, text: 'Bonjour' },
                { speaker: 'Speaker 1', start: 1.1, end: 2.0, text: 'Salut' },
              ],
            }),
          }] },
        }],
      }),
      text: async () => '',
    });

    const results = await provider.transcribeFile(
      '/fake/chunk_000.mp3',
      { language: 'fr', diarize: true },
      () => {},
      new AbortController().signal
    );

    // Verify x-goog-api-key header used (not query param)
    const fetchCall = mockFetch.mock.calls[0];
    const fetchOptions = fetchCall[1] as RequestInit;
    expect((fetchOptions.headers as Record<string, string>)['x-goog-api-key']).toBe('test-google-key');

    // Verify fetch URL does NOT include query param
    const fetchUrl = fetchCall[0] as string;
    expect(fetchUrl).not.toContain('?key=');

    expect(results).toHaveLength(1);
    expect(results[0].chunkIndex).toBe(0);
    expect(results[0].turns).toHaveLength(2);
    expect(results[0].turns[0].speakerLabel).toBe('Speaker 0');
    expect(results[0].turns[1].speakerLabel).toBe('Speaker 1');
    expect(results[0].turns[0].startMs).toBe(0);
    expect(results[0].turns[0].endMs).toBe(1000);
    expect(results[0].turns[0].text).toBe('Bonjour');
  });

  it('triggers File API path when file > 20 MB', async () => {
    // File API initiate
    mockFetch.mockResolvedValueOnce({
      ok: true,
      headers: new Headers({ 'x-goog-upload-url': 'https://googleapis.com/upload/12345' }),
      json: async () => ({}),
      text: async () => '',
    });
    // File API upload
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ file: { uri: 'https://cdn.googleapis.com/files/abc123' } }),
      text: async () => '',
    });
    // Generate content (uses fileData, not inlineData)
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        candidates: [{
          content: { parts: [{ text: JSON.stringify({ utterances: [] }) }] },
        }],
      }),
      text: async () => '',
    });

    const results = await provider.transcribeFile(
      '/fake/large-chunk.mp3',
      { language: 'auto', diarize: true },
      () => {},
      new AbortController().signal
    );

    expect(results[0].turns).toHaveLength(0);
    // 3 fetch calls: initiate + upload + generateContent
    expect(mockFetch).toHaveBeenCalledTimes(3);
  });

  it('throws when generateContent HTTP response is not ok', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 403,
      text: async () => 'Permission denied',
    });

    await expect(
      provider.transcribeFile('/fake/audio.mp3', { language: 'en', diarize: true }, () => {}, new AbortController().signal)
    ).rejects.toThrow('Google Gemini transcription failed: HTTP 403');
  });

  it('throws when model returns malformed JSON (non-JSON response)', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        candidates: [{
          content: { parts: [{ text: 'this is not json {{{' }] },
        }],
      }),
      text: async () => '',
    });

    // Malformed JSON now throws — responseMimeType:'application/json' instructs Gemini
    // to return JSON; if it doesn't, something went wrong and the error propagates.
    await expect(
      provider.transcribeFile(
        '/fake/audio.mp3',
        { language: 'en', diarize: true },
        () => {},
        new AbortController().signal
      )
    ).rejects.toThrow('Google: model returned unparseable response. Fragment:');
  });

  it('handles missing candidates in response', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ candidates: [] }),
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

  it('throws when File API initiate fails', async () => {
    // Initiate step fails
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 400,
      headers: new Headers({}),
      json: async () => ({}),
      text: async () => '',
    });

    await expect(
      provider.transcribeFile(
        '/fake/large-audio.mp3',
        { language: 'auto', diarize: true },
        () => {},
        new AbortController().signal
      )
    ).rejects.toThrow('Google File API initiate failed: HTTP 400');
  });

  it('passes language instruction for French', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        candidates: [{
          content: { parts: [{ text: JSON.stringify({ utterances: [] }) }] },
        }],
      }),
      text: async () => '',
    });

    await provider.transcribeFile('/fake/audio.mp3', { language: 'fr', diarize: true }, () => {}, new AbortController().signal);

    const fetchOptions = mockFetch.mock.calls[0][1] as RequestInit;
    const bodyStr = fetchOptions.body as string;
    expect(bodyStr).toContain('French');
  });
});
