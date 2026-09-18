import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OpenAIProvider } from '../../../src/main/providers/openai';
import log from 'electron-log';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  return { ...actual, readFileSync: vi.fn(() => Buffer.alloc(1024, 0)) };
});

// electron-log: silence output in tests, provide minimal API surface for spying.
vi.mock('electron-log', () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

describe('OpenAIProvider', () => {
  const provider = new OpenAIProvider('sk-test-key');

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(log.warn).mockClear();
  });

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

  it('maps usage.input_tokens/output_tokens/audio_tokens to a tokens ProviderUsage', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        segments: [{ speaker: '0', start: 0.0, end: 1.0, text: 'Hi' }],
        usage: { input_tokens: 100, output_tokens: 20, input_token_details: { audio_tokens: 90 } },
      }),
      text: async () => '',
    });

    const results = await provider.transcribeFile(
      '/fake/audio.mp3', { language: 'en', diarize: true }, () => {}, new AbortController().signal
    );

    expect(results[0].usage).toEqual({ kind: 'tokens', inputTokens: 100, outputTokens: 20, audioTokens: 90 });
  });

  // This is the plan's own "an absent usage must not silently compute as $0" contract —
  // this project's configured OpenAI key lacks access to gpt-4o-transcribe-diarize, so
  // Phase 5's real-call verification could not confirm the field name against a real
  // response; this degrade path is what makes that gap safe either way.
  it('logs a warning and omits usage when the usage field is absent (never defaults to zero)', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        segments: [{ speaker: '0', start: 0.0, end: 1.0, text: 'Hi' }],
      }),
      text: async () => '',
    });

    const results = await provider.transcribeFile(
      '/fake/audio.mp3', { language: 'en', diarize: true }, () => {}, new AbortController().signal
    );

    expect(results[0].usage).toBeUndefined();
    expect(log.warn).toHaveBeenCalledWith(expect.stringContaining('usage field missing or invalid in response'));
  });

  // Fix 5 (review pass): the existing absence test only simulates the usage field being
  // completely missing. This is the literal regression test for Fix 2's OpenAI half —
  // a *present* but malformed usage object (no numeric fields) must degrade the same
  // way, not fabricate a fully-formed-looking { inputTokens: 0, outputTokens: 0 }.
  it('logs a warning and omits usage when usage is present but missing numeric fields', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        segments: [{ speaker: '0', start: 0.0, end: 1.0, text: 'Hi' }],
        usage: {},
      }),
      text: async () => '',
    });

    const results = await provider.transcribeFile(
      '/fake/audio.mp3', { language: 'en', diarize: true }, () => {}, new AbortController().signal
    );

    expect(results[0].usage).toBeUndefined();
    expect(log.warn).toHaveBeenCalledWith(expect.stringContaining('usage field missing or invalid in response'));
  });

  // OpenAI's usage object is documented as polymorphic (discriminated by `type`):
  // a "duration" usage object should never be read as a "tokens" one, even if it
  // happens to carry numeric-looking fields under the same names.
  it('logs a warning and omits usage when usage.type is "duration" instead of "tokens"', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        segments: [{ speaker: '0', start: 0.0, end: 1.0, text: 'Hi' }],
        usage: { type: 'duration', input_tokens: 100, output_tokens: 20 },
      }),
      text: async () => '',
    });

    const results = await provider.transcribeFile(
      '/fake/audio.mp3', { language: 'en', diarize: true }, () => {}, new AbortController().signal
    );

    expect(results[0].usage).toBeUndefined();
    expect(log.warn).toHaveBeenCalledWith(expect.stringContaining('usage field missing or invalid in response'));
  });
});
