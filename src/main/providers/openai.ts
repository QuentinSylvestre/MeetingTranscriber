import * as fs from 'fs';
import * as path from 'path';
import log from 'electron-log';
import type { TranscriptionProvider, TranscriptionOptions, TranscriptChunkResult, SpeakerTurn, ProviderUsage } from './types';

const OPENAI_TRANSCRIBE_URL = 'https://api.openai.com/v1/audio/transcriptions';

// gpt-4o-transcribe-diarize: dedicated diarization model (released April 2025).
// Requires response_format="diarized_json" and chunking_strategy="auto" for
// recordings over 30 seconds. Returns segments with speaker, start, end, text.
// Requires plan-level access — throws a clear error on 403.
//
// Note: this model does not accept a language parameter.
const MODEL_DIARIZE = 'gpt-4o-transcribe-diarize';

export class OpenAIProvider implements TranscriptionProvider {
  name = 'openai';

  constructor(private readonly apiKey: string) {}

  async transcribeFile(
    filePath: string,
    options: TranscriptionOptions,
    onProgress: (status: string) => void,
    signal: AbortSignal
  ): Promise<TranscriptChunkResult[]> {
    if (!options.diarize) {
      throw new Error('OpenAI provider requires diarize: true — speaker labels are the only supported output format');
    }

    const fileBuffer = fs.readFileSync(filePath);
    const filename = path.basename(filePath);
    const fileSizeMb = Math.round(fileBuffer.length / 1024 / 1024);

    if (fileSizeMb > 20) {
      log.warn(`OpenAI: chunk ${filename} is ${fileSizeMb} MB (soft limit 20 MB)`);
    }

    const ext = path.extname(filename).toLowerCase();
    const mimeType: Record<string, string> = {
      '.mp3': 'audio/mpeg', '.mp4': 'audio/mp4', '.m4a': 'audio/mp4',
      '.wav': 'audio/wav', '.ogg': 'audio/ogg', '.webm': 'audio/webm',
    };

    onProgress('Transcribing (with diarization)...');

    const formData = new FormData();
    formData.append('file', new Blob([fileBuffer], { type: mimeType[ext] ?? 'audio/mpeg' }), filename);
    formData.append('model', MODEL_DIARIZE);
    formData.append('response_format', 'diarized_json');
    // chunking_strategy=auto is required for recordings over 30 seconds.
    // gpt-4o-transcribe-diarize does not support the language parameter.
    formData.append('chunking_strategy', 'auto');

    const resp = await fetch(OPENAI_TRANSCRIBE_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.apiKey}` },
      body: formData,
      signal,
    });

    if (!resp.ok) {
      const errText = await resp.text().catch(() => '');
      if (resp.status === 403) {
        throw new Error(
          `OpenAI: your project does not have access to ${MODEL_DIARIZE}. ` +
          `See the in-app guidance to enable it.`
        );
      }
      throw new Error(`OpenAI transcription failed: HTTP ${resp.status} ${errText.slice(0, 200)}`);
    }

    // diarized_json response: { segments: [{ speaker, start, end, text }], usage? }
    // NOTE: the usage shape below is from OpenAI's documented Realtime/Audio usage
    // object, not confirmed against a real diarized_json response — this project's
    // configured OpenAI key does not have plan-level access to gpt-4o-transcribe-diarize
    // (real Phase 5 verification call returned HTTP 403 model_not_found), so the one
    // real-call check this phase requires could not run for this provider. Log-and-omit
    // below is what makes that gap safe: an unconfirmed/wrong field name degrades to
    // "no usage" rather than a silently wrong cost.
    const result = (await resp.json()) as {
      segments?: Array<{ speaker?: string; start: number; end: number; text: string }>;
      // OpenAI's usage object is documented as polymorphic, discriminated by `type`:
      // {"type":"tokens", input_tokens, output_tokens, ...} vs {"type":"duration", seconds}.
      usage?: { type?: string; input_tokens?: number; output_tokens?: number; input_token_details?: { audio_tokens?: number } };
    };

    onProgress('Complete');
    log.info(`OpenAI diarize: ${result.segments?.length ?? 0} segments, ${filename}`);

    const turns: SpeakerTurn[] = (result.segments ?? []).map((seg) => ({
      speakerLabel: `Speaker ${seg.speaker ?? '0'}`,
      startMs: Math.round(seg.start * 1000),
      endMs: Math.round(seg.end * 1000),
      text: seg.text.trim(),
    }));

    let usage: ProviderUsage | undefined;
    try {
      // Guard on the actual numeric fields, not just parent-object truthiness — a
      // present-but-malformed usage object (e.g. `usage: {}`, or a `type: "duration"`
      // shape that doesn't carry token counts) must never silently compute as a $0
      // cost. Both inputTokens and outputTokens are required numeric, matching the
      // other adapters' "both-fields-numeric" gate for the tokens usage kind.
      const usageData = result.usage;
      if (
        usageData &&
        typeof usageData.input_tokens === 'number' &&
        typeof usageData.output_tokens === 'number' &&
        (usageData.type === undefined || usageData.type === 'tokens')
      ) {
        usage = {
          kind: 'tokens',
          inputTokens: usageData.input_tokens,
          outputTokens: usageData.output_tokens,
          audioTokens: usageData.input_token_details?.audio_tokens,
        };
      } else {
        log.warn(`OpenAI transcribe: usage field missing or invalid in response (${filename}) — cost will be unknown for this call`);
      }
    } catch (err) {
      log.warn(`OpenAI transcribe: error deriving usage from response (${filename}) — cost will be unknown for this call`, err);
    }

    return [{ chunkIndex: 0, turns, usage }];
  }
}
