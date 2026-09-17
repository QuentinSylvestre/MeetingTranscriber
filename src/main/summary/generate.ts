import log from 'electron-log';
import { SUMMARY_MODEL, type SummaryErrorCode } from '../../shared/ipc-types';
import { MUNICIPAL_SUMMARY_PROMPT, summaryInput } from './prompt';
import { summaryJsonSchema, validateSummary, SummaryValidationError, type MeetingSummary } from './schema';

export { SUMMARY_MODEL };
/**
 * Sized so the output budget below can actually serve it. The golden meeting is
 * ~68k characters and yields ~23k characters of JSON, about 7.8k output tokens —
 * roughly 115 output tokens per 1k transcript characters. At 120k characters that
 * is ~13.8k tokens, leaving ~10k of the 24k budget for reasoning. The previous
 * 250k limit needed ~28.7k output tokens on its own and could not be met, so a long
 * meeting always burned a paid request and returned `incomplete`. Raise both numbers
 * together, and only after measuring a real run at the new length.
 */
export const MAX_TRANSCRIPT_CHARACTERS = 120_000;

export class SummaryError extends Error {
  constructor(readonly code: SummaryErrorCode) { super(code); }
}

export function checkTranscript(transcript: string): void {
  if (!transcript.trim()) throw new SummaryError('empty_transcript');
  if (transcript.length > MAX_TRANSCRIPT_CHARACTERS) throw new SummaryError('transcript_too_long');
}

/** Overrides used only by the offline evaluation harness; production passes nothing. */
export interface SummaryOptions {
  model?: string;
  /** Receives each unsupported claim removed during validation. */
  onDegrade?: (reason: string) => void;
  /** Receives the provider's token accounting, when it reports any. */
  onUsage?: (usage: unknown) => void;
}

/** One request, no tools, no automatic retry and no persisted provider response. */
export async function generateSummary(
  transcript: string, apiKey: string, durationMs?: number, options: SummaryOptions = {},
): Promise<MeetingSummary> {
  checkTranscript(transcript);
  if (!apiKey.trim()) throw new SummaryError('missing_key');
  try {
    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(180_000),
      body: JSON.stringify({
        model: options.model ?? SUMMARY_MODEL, store: false, reasoning: { effort: 'medium' },
        max_output_tokens: 24_000,
        instructions: MUNICIPAL_SUMMARY_PROMPT,
        input: summaryInput(transcript, durationMs),
        text: { format: { type: 'json_schema', name: 'municipal_summary', strict: true, schema: summaryJsonSchema } },
      }),
    });
    // Log the status and the provider's own error code, never the body: it can echo
    // the transcript. Without this a field failure leaves no trace at all.
    if (!response.ok) {
      let code: string | undefined;
      try { code = ((await response.json()) as { error?: { code?: string } }).error?.code; }
      catch { /* body absent or not JSON */ }
      log.error(`Summary: provider returned HTTP ${response.status}${code ? ` (${code})` : ''}`);
      throw new SummaryError('provider_error');
    }
    const payload = await response.json() as {
      status?: string;
      incomplete_details?: { reason?: string };
      usage?: unknown;
      output?: Array<{ type: string; content?: Array<{ type: string; text?: string }> }>;
    };
    if (payload.usage !== undefined) options.onUsage?.(payload.usage);
    // Truncation and a server-side failure need different advice: only the first is
    // worth retrying unchanged, so they must not share one error code.
    if (payload.status === 'incomplete') {
      log.error(`Summary: response incomplete (${payload.incomplete_details?.reason ?? 'reason not given'})`);
      throw new SummaryError('incomplete');
    }
    if (payload.status !== 'completed') {
      log.error(`Summary: provider reported status "${payload.status ?? 'missing'}"`);
      throw new SummaryError('provider_error');
    }
    const content = (payload.output ?? []).filter(item => item.type === 'message').flatMap(item => item.content ?? []);
    if (content.some(item => item.type === 'refusal')) {
      log.error('Summary: provider refused the request');
      throw new SummaryError('refused');
    }
    const outputText = content.filter(item => item.type === 'output_text').map(item => item.text ?? '').join('');
    let value: unknown;
    try { value = JSON.parse(outputText); }
    catch { log.error('Summary: provider output was not valid JSON'); throw new SummaryError('invalid_summary'); }
    // Unsupported claims are stripped, not fatal, so the removals are the only record
    // of what the model over-claimed. They must reach the log.
    const removed: string[] = [];
    const summary = validateSummary(value, transcript, durationMs, reason => {
      removed.push(reason);
      options.onDegrade?.(reason);
    });
    for (const reason of removed) log.warn(`Summary: ${reason}`);
    log.info(`Summary: validated ${summary.topics.length} topics, ${removed.length} unsupported claim(s) removed`);
    return summary;
  } catch (error) {
    if (error instanceof SummaryError) throw error;
    if (error instanceof SummaryValidationError) {
      log.error('Summary: local validation rejected the model output');
      throw new SummaryError('invalid_summary');
    }
    if (error instanceof Error && ['TimeoutError', 'AbortError'].includes(error.name)) {
      log.error('Summary: request timed out locally; the provider may still bill it');
      throw new SummaryError('timeout');
    }
    log.error(`Summary: request failed (${error instanceof Error ? error.name : 'unknown'})`);
    throw new SummaryError('provider_error');
  }
}
