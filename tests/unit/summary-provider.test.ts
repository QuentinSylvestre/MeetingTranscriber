import { afterEach, describe, expect, it, vi } from 'vitest';
import { generateSummary, MAX_TRANSCRIPT_CHARACTERS, SUMMARY_MODEL } from '../../src/main/summary/generate';
import { summaryTranscript, summaryFilename } from '../../src/main/summary/transcript';

const transcript = '[00:00:01] Alice: Les travaux sont terminés.';
const summary = { meetingInfo: { date: null, dateEvidence: null, startTime: null, startTimeEvidence: null,
      endTime: null, endTimeEvidence: null, secretary: null, secretaryEvidence: null,
      present: [], absentOrExcused: [] },
  topics: [{ title: 'Travaux', category: 'follow_up', renderHint: 'standard', previousMinutes: null,
    context: 'Les travaux sont terminés.', discussion: [], objections: [], alternatives: [], conclusion: null,
    decision: null, actions: [], openPoints: [], verificationNotes: [] }] };
const response = (value: unknown) => ({ ok: true, json: async () => value });
const completed = (text = JSON.stringify(summary)) => ({ status: 'completed',
  output: [{ type: 'message', content: [{ type: 'output_text', text }] }] });
afterEach(() => vi.unstubAllGlobals());

describe('single-pass summary provider', () => {
  it('uses strict native structured output, validates locally, and disables storage', async () => {
    const fetch = vi.fn().mockResolvedValue(response(completed()));
    vi.stubGlobal('fetch', fetch);
    expect(await generateSummary(transcript, 'test-placeholder')).toEqual(summary);
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, request] = fetch.mock.calls[0];
    expect(url).toBe('https://api.openai.com/v1/responses');
    const body = JSON.parse(request.body);
    expect(body.model).toBe(SUMMARY_MODEL);
    expect(body.store).toBe(false);
    expect(body.reasoning).toEqual({ effort: 'medium' });
    expect(body.temperature).toBeUndefined();
    expect(body.max_output_tokens).toBe(24_000);
    expect(body.tools).toBeUndefined();
    expect(body.text.format).toMatchObject({ type: 'json_schema', strict: true });
    expect(JSON.parse(body.input).transcript).toBe(transcript);
    expect(request.signal).toBeInstanceOf(AbortSignal);
  });
  it.each([
    [completed('not json'), 'invalid_summary'],
    [completed('{"topics":[]}'), 'invalid_summary'],
    [{ status: 'incomplete', output: [] }, 'incomplete'],
    // A server-side failure is not truncation: retrying it unchanged just bills again.
    [{ status: 'failed', output: [] }, 'provider_error'],
    [{ status: 'completed', output: [{ type: 'message', content: [{ type: 'refusal' }] }] }, 'refused'],
  ])('rejects invalid, incomplete and refused responses', async (payload, error) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response(payload)));
    await expect(generateSummary(transcript, 'test-placeholder')).rejects.toThrow(error as string);
  });
  it('does not expose provider error bodies or retry billable failures', async () => {
    const fetch = vi.fn().mockResolvedValue({ ok: false, text: () => 'PRIVATE TRANSCRIPT' });
    vi.stubGlobal('fetch', fetch);
    await expect(generateSummary(transcript, 'test-placeholder')).rejects.toThrow(/^provider_error$/);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('maps timeouts without leaking request details', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new DOMException('private data', 'TimeoutError')));
    await expect(generateSummary(transcript, 'test-placeholder')).rejects.toThrow(/^timeout$/);
  });
  it('rejects empty, oversized and unconfigured requests before sending', async () => {
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    await expect(generateSummary(' ', 'test-placeholder')).rejects.toThrow('empty_transcript');
    await expect(generateSummary('x'.repeat(MAX_TRANSCRIPT_CHARACTERS + 1), 'test-placeholder')).rejects.toThrow('transcript_too_long');
    await expect(generateSummary(transcript, '')).rejects.toThrow('missing_key');
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe('summary transcript snapshot', () => {
  it('uses edited text and chunk-specific renamed speakers in timestamp order', () => {
    const turn = { id: 't1', job_id: 'j', chunk_index: 0, speaker_label: 'Speaker 1', start_ms: 1000,
      end_ms: 2000, text: 'Texte corrigé', original_text: 'Texte original' };
    const input = summaryTranscript([{ ...turn, chunk_index: 1, start_ms: 4000 }, turn], [
      { job_id: 'j', chunk_index: 0, speaker_label: 'Speaker 1', display_name: 'Alice' },
      { job_id: 'j', chunk_index: 1, speaker_label: 'Speaker 1', display_name: 'Bob' },
    ]);
    expect(input).toBe('[00:00:01] Alice: Texte corrigé\n[00:00:04] Bob: Texte corrigé');
    expect(input).not.toContain('original');
  });
  it('keeps document filenames safe on Windows', () => {
    expect(summaryFilename('CON')).toBe('Compte rendu - CON.docx');
    expect(summaryFilename('séance: 2026/09')).toBe('Compte rendu - séance_ 2026_09.docx');
  });
});
