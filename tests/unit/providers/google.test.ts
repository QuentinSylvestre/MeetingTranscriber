import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GoogleProvider } from '../../../src/main/providers/google';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  return {
    ...actual,
    readFileSync: vi.fn(() => Buffer.alloc(1024, 0)),
  };
});

// Helpers for building mock responses in the new API shape.
function makeWordAnnotation(text: string, speaker: string, startS: number, endS: number) {
  return {
    type: 'word_info',
    text,
    speaker,
    start_offset: `${startS}s`,
    end_offset: `${endS}s`,
  };
}

function makeInteractionResponse(annotations: ReturnType<typeof makeWordAnnotation>[]) {
  return {
    steps: [{
      content: [{
        text: annotations.map(a => a.text).join(' '),
        annotations,
      }],
    }],
  };
}

// Two fetch calls are always needed: upload initiate + upload data + interactions.
// Helper to mock the upload flow then the transcription response.
function mockUploadThenTranscribe(transcriptionResponse: unknown) {
  // Upload initiate
  mockFetch.mockResolvedValueOnce({
    ok: true,
    headers: new Headers({ 'x-goog-upload-url': 'https://googleapis.com/upload/12345' }),
    json: async () => ({}),
    text: async () => '',
  });
  // Upload data
  mockFetch.mockResolvedValueOnce({
    ok: true,
    json: async () => ({ file: { uri: 'https://generativelanguage.googleapis.com/files/abc123' } }),
    text: async () => '',
  });
  // Interactions call
  mockFetch.mockResolvedValueOnce({
    ok: true,
    json: async () => transcriptionResponse,
    text: async () => '',
  });
}

describe('GoogleProvider', () => {
  const provider = new GoogleProvider('test-google-key');

  beforeEach(() => { vi.clearAllMocks(); });

  it('groups word annotations by speaker into turns', async () => {
    mockUploadThenTranscribe(makeInteractionResponse([
      makeWordAnnotation('Bonjour', 'spk_0', 0.0, 0.5),
      makeWordAnnotation('tout', 'spk_0', 0.6, 0.8),
      makeWordAnnotation('le', 'spk_0', 0.9, 1.0),
      makeWordAnnotation('monde', 'spk_0', 1.1, 1.5),
      makeWordAnnotation('Salut', 'spk_1', 1.6, 2.0),
    ]));

    const results = await provider.transcribeFile(
      '/fake/chunk.mp3',
      { language: 'fr', diarize: true },
      () => {},
      new AbortController().signal
    );

    expect(results).toHaveLength(1);
    expect(results[0].turns).toHaveLength(2);
    expect(results[0].turns[0].speakerLabel).toBe('Speaker 0');
    expect(results[0].turns[0].text).toBe('Bonjour tout le monde');
    expect(results[0].turns[0].startMs).toBe(0);
    expect(results[0].turns[0].endMs).toBe(1500);
    expect(results[0].turns[1].speakerLabel).toBe('Speaker 1');
    expect(results[0].turns[1].text).toBe('Salut');
  });

  it('uses /v1beta/interactions endpoint with correct model and transcription_config', async () => {
    mockUploadThenTranscribe({ steps: [] });

    await provider.transcribeFile(
      '/fake/audio.mp3',
      { language: 'en', diarize: true },
      () => {},
      new AbortController().signal
    );

    // Third call is the interactions request
    const interactionsCall = mockFetch.mock.calls[2];
    expect(interactionsCall[0]).toBe('https://generativelanguage.googleapis.com/v1beta/interactions');

    const body = JSON.parse(interactionsCall[1].body as string);
    expect(body.model).toBe('gemini-3.5-transcribe');
    expect(body.input[0].type).toBe('audio');
    expect(body.generation_config.transcription_config.mode.diarization_mode).toBe('speaker');
    expect(body.generation_config.transcription_config.mode.timestamp_granularities).toContain('word');

    // Auth via header, not query param
    expect(interactionsCall[1].headers['x-goog-api-key']).toBe('test-google-key');
    expect(interactionsCall[0]).not.toContain('?key=');
  });

  it('sends BCP-47 language code for French', async () => {
    mockUploadThenTranscribe({ steps: [] });

    await provider.transcribeFile('/fake/audio.mp3', { language: 'fr', diarize: true }, () => {}, new AbortController().signal);

    const body = JSON.parse(mockFetch.mock.calls[2][1].body as string);
    expect(body.generation_config.transcription_config.language_codes).toEqual(['fr-FR']);
  });

  it('omits language_codes for auto-detect', async () => {
    mockUploadThenTranscribe({ steps: [] });

    await provider.transcribeFile('/fake/audio.mp3', { language: 'auto', diarize: true }, () => {}, new AbortController().signal);

    const body = JSON.parse(mockFetch.mock.calls[2][1].body as string);
    expect(body.generation_config.transcription_config.language_codes).toBeUndefined();
  });

  it('returns empty turns when steps are empty', async () => {
    mockUploadThenTranscribe({ steps: [] });

    const results = await provider.transcribeFile(
      '/fake/audio.mp3',
      { language: 'en', diarize: true },
      () => {},
      new AbortController().signal
    );

    expect(results[0].turns).toHaveLength(0);
  });

  it('throws when interactions HTTP response is not ok', async () => {
    // Upload succeeds
    mockFetch.mockResolvedValueOnce({
      ok: true,
      headers: new Headers({ 'x-goog-upload-url': 'https://googleapis.com/upload/12345' }),
      json: async () => ({}),
      text: async () => '',
    });
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ file: { uri: 'https://generativelanguage.googleapis.com/files/abc123' } }),
      text: async () => '',
    });
    // Interactions fails
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 403,
      text: async () => 'Permission denied',
    });

    await expect(
      provider.transcribeFile('/fake/audio.mp3', { language: 'en', diarize: true }, () => {}, new AbortController().signal)
    ).rejects.toThrow('Google Gemini transcription failed: HTTP 403');
  });

  it('throws when File API initiate fails', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 400,
      headers: new Headers({}),
      json: async () => ({}),
      text: async () => '',
    });

    await expect(
      provider.transcribeFile('/fake/audio.mp3', { language: 'auto', diarize: true }, () => {}, new AbortController().signal)
    ).rejects.toThrow('Google File API initiate failed: HTTP 400');
  });
});
