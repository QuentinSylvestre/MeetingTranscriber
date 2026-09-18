import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ElevenLabsProvider } from '../../../src/main/providers/elevenlabs';
import log from 'electron-log';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  return { ...actual, readFileSync: vi.fn(() => Buffer.from('fake-audio')) };
});

// electron-log: silence output in tests, provide minimal API surface for spying.
vi.mock('electron-log', () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

describe('ElevenLabsProvider', () => {
  const provider = new ElevenLabsProvider('test-xi-key');

  beforeEach(() => {
    mockFetch.mockReset();
    vi.mocked(log.warn).mockClear();
  });

  it('maps integer speaker IDs to Speaker N labels', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        words: [
          { type: 'word', speaker_id: 0, text: 'Hello', start: 0.0, end: 0.5 },
          { type: 'spacing', text: ' ' },
          { type: 'word', speaker_id: 1, text: 'Hi', start: 0.6, end: 0.9 },
          { type: 'word', speaker_id: 1, text: 'there', start: 0.9, end: 1.2 },
        ],
      }),
    });

    const results = await provider.transcribeFile(
      '/fake/audio.mp3',
      { language: 'fr', diarize: true },
      () => {},
      new AbortController().signal
    );

    expect(results[0].turns[0].speakerLabel).toBe('Speaker 0');
    expect(results[0].turns[1].speakerLabel).toBe('Speaker 1');
    expect(results[0].turns[1].text).toBe('Hi there'); // consecutive words grouped
  });

  it('handles missing speaker_id by defaulting to Speaker 0', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        words: [{ type: 'word', text: 'Alone', start: 0.0, end: 0.5 }],
      }),
    });
    const results = await provider.transcribeFile(
      '/fake/audio.mp3', { language: 'fr', diarize: false }, () => {}, new AbortController().signal
    );
    expect(results[0].turns[0].speakerLabel).toBe('Speaker 0');
  });

  it('throws on HTTP error', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 429,
      text: async () => 'Rate limit exceeded',
    });
    await expect(
      provider.transcribeFile('/fake/audio.mp3', { language: 'en', diarize: false }, () => {}, new AbortController().signal)
    ).rejects.toThrow('HTTP 429');
  });

  it('returns empty turns for empty words array', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ words: [] }),
    });
    const results = await provider.transcribeFile(
      '/fake/audio.mp3', { language: 'auto', diarize: false }, () => {}, new AbortController().signal
    );
    expect(results[0].turns).toHaveLength(0);
    expect(results[0].chunkIndex).toBe(0);
  });

  it('converts word timestamps from seconds to milliseconds', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        words: [
          { type: 'word', speaker_id: 0, text: 'Test', start: 1.5, end: 2.3 },
        ],
      }),
    });
    const results = await provider.transcribeFile(
      '/fake/audio.mp3', { language: 'fr', diarize: true }, () => {}, new AbortController().signal
    );
    expect(results[0].turns[0].startMs).toBe(1500);
    expect(results[0].turns[0].endMs).toBe(2300);
  });

  it('maps audio_duration_secs to a duration ProviderUsage', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        words: [{ type: 'word', speaker_id: 0, text: 'Hello', start: 0.0, end: 0.5 }],
        audio_duration_secs: 10,
      }),
    });
    const results = await provider.transcribeFile(
      '/fake/audio.mp3', { language: 'fr', diarize: true }, () => {}, new AbortController().signal
    );
    expect(results[0].usage).toEqual({ kind: 'duration', seconds: 10 });
  });

  // Real-call verification (Phase 5) found no audio_duration_secs field in a real
  // v1/speech-to-text response — this degradation path is not merely defensive.
  it('logs a warning and omits usage when audio_duration_secs is absent (never defaults to 0)', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        words: [{ type: 'word', speaker_id: 0, text: 'Hello', start: 0.0, end: 0.5 }],
      }),
    });
    const results = await provider.transcribeFile(
      '/fake/audio.mp3', { language: 'fr', diarize: true }, () => {}, new AbortController().signal
    );
    expect(results[0].usage).toBeUndefined();
    expect(log.warn).toHaveBeenCalledWith(expect.stringContaining('no audio_duration_secs field'));
  });
});
