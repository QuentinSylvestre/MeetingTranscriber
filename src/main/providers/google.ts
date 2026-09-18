import * as fs from 'fs';
import * as path from 'path';
import log from 'electron-log';
import type { TranscriptionProvider, TranscriptionOptions, TranscriptChunkResult, SpeakerTurn, ProviderUsage } from './types';

// Gemini 3.5 Transcribe — dedicated speech-to-text model.
// Docs: https://ai.google.dev/gemini-api/docs/transcribe
//
// Endpoint:  POST /v1beta/interactions
// Model:     gemini-3.5-transcribe
// Auth:      x-goog-api-key header
//
// Files are uploaded via the Files API first, then referenced by URI.
// Diarization:   transcription_config.mode.diarization_mode = "speaker"
// Timestamps:    transcription_config.mode.timestamp_granularities = ["word"]
// Language hint: transcription_config.language_codes = ["fr-FR"] (BCP-47)
//
// Response annotations: steps[].content[].annotations[] where type == "word_info"
// Each word_info has: text, speaker (e.g. "spk_1"), start_offset ("0.500s"), end_offset
// The full plain-text transcript is in interaction.output_text.
//
// Limitations:
//   - Max 30 minutes when diarization is enabled
//   - Up to 8 speakers (3+ is experimental)
//   - custom_vocabulary is incompatible with diarization

const INTERACTIONS_URL = 'https://generativelanguage.googleapis.com/v1beta/interactions';
const FILES_API_URL = 'https://generativelanguage.googleapis.com/upload/v1beta/files';
const MODEL = 'gemini-3.5-transcribe';

// Map our language codes to BCP-47 codes the API accepts.
const LANGUAGE_CODE: Record<string, string> = {
  fr: 'fr-FR',
  en: 'en-US',
};

export class GoogleProvider implements TranscriptionProvider {
  name = 'google';

  constructor(private readonly apiKey: string) {}

  async transcribeFile(
    filePath: string,
    options: TranscriptionOptions,
    onProgress: (status: string) => void,
    signal: AbortSignal
  ): Promise<TranscriptChunkResult[]> {
    onProgress('Uploading audio...');

    // Always upload via Files API — the interactions endpoint requires a URI reference.
    const fileBuffer = fs.readFileSync(filePath);
    const filename = path.basename(filePath);
    const ext = path.extname(filename).toLowerCase();
    const mimeType: Record<string, string> = {
      '.mp3': 'audio/mp3', '.mp4': 'audio/mp4', '.m4a': 'audio/m4a',
      '.wav': 'audio/wav', '.ogg': 'audio/ogg', '.webm': 'audio/webm',
    };
    const audioMime = mimeType[ext] ?? 'audio/mp3';

    log.info(`Google: uploading ${filename} (${Math.round(fileBuffer.length / 1024 / 1024)} MB)`);
    const fileUri = await this.uploadFile(filePath, fileBuffer, audioMime, signal);

    onProgress('Transcribing...');

    // Build transcription_config.
    // diarization_mode + timestamp_granularities require verbatim mode.
    // language_codes: omit for auto-detect, supply BCP-47 code otherwise.
    const transcriptionConfig: Record<string, unknown> = {
      mode: {
        type: 'verbatim',
        diarization_mode: 'speaker',
        timestamp_granularities: ['word'],
      },
    };
    if (options.language !== 'auto') {
      const bcp47 = LANGUAGE_CODE[options.language];
      if (bcp47) transcriptionConfig.language_codes = [bcp47];
    }

    const requestBody = {
      model: MODEL,
      input: [
        {
          type: 'audio',
          uri: fileUri,
          mime_type: audioMime,
        },
      ],
      generation_config: {
        transcription_config: transcriptionConfig,
      },
    };

    const resp = await fetch(INTERACTIONS_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': this.apiKey,
      },
      body: JSON.stringify(requestBody),
      signal,
    });

    if (!resp.ok) {
      const errText = await resp.text().catch(() => '');
      throw new Error(`Google Gemini transcription failed: HTTP ${resp.status} ${errText.slice(0, 200)}`);
    }

    // Response shape:
    // {
    //   steps: [{
    //     content: [{
    //       text: "full transcript",
    //       annotations: [
    //         { type: "word_info", text: "Hello", speaker: "spk_1",
    //           start_offset: "0.100s", end_offset: "0.450s" },
    //         ...
    //       ]
    //     }]
    //   }]
    // }
    type WordInfo = { type: string; text: string; speaker?: string; start_offset?: string; end_offset?: string };
    type ContentBlock = { text?: string; annotations?: WordInfo[] };
    type Step = { content?: ContentBlock[] };
    // Usage shape confirmed via a real Phase 5 verification call against
    // /v1beta/interactions: the plan's guessed promptTokenCount/candidatesTokenCount
    // (the older generateContent API's usageMetadata shape) does NOT apply here.
    // The real, top-level `usage` object looks like:
    //   { total_input_tokens, total_output_tokens, total_cached_tokens,
    //     input_tokens_by_modality: [{ modality: 'text'|'audio', tokens }], ... }
    type ModalityTokens = { modality: string; tokens: number };
    type InteractionUsage = {
      total_input_tokens?: number;
      total_output_tokens?: number;
      total_cached_tokens?: number;
      input_tokens_by_modality?: ModalityTokens[];
    };
    const result = (await resp.json()) as { steps?: Step[]; usage?: InteractionUsage };

    let usage: ProviderUsage | undefined;
    if (result.usage) {
      const audioTokens = result.usage.input_tokens_by_modality?.find((m) => m.modality === 'audio')?.tokens;
      usage = {
        kind: 'tokens',
        inputTokens: result.usage.total_input_tokens ?? 0,
        outputTokens: result.usage.total_output_tokens ?? 0,
        audioTokens,
        cachedTokens: result.usage.total_cached_tokens,
      };
    } else {
      log.warn('Google transcribe: no usage field in response — cost will be unknown for this call');
    }

    // Collect all word_info annotations across all steps/content blocks.
    const words: WordInfo[] = [];
    for (const step of result.steps ?? []) {
      for (const content of step.content ?? []) {
        for (const annotation of content.annotations ?? []) {
          if (annotation.type === 'word_info') words.push(annotation);
        }
      }
    }

    onProgress('Complete');
    log.info(`Google: ${words.length} word annotations, ${filename}`);

    if (words.length === 0) {
      log.warn('Google: no word annotations returned (silent audio or diarization produced no words)');
      return [{ chunkIndex: 0, turns: [], usage }];
    }

    // Group consecutive words by speaker into turns.
    const turns: SpeakerTurn[] = [];
    let currentSpeaker: string | null = null;
    let currentWords: string[] = [];
    let currentStart = 0;
    let currentEnd = 0;

    const parseOffset = (s?: string): number => {
      // Format: "0.500s" — strip trailing 's' and convert to ms.
      if (!s) return 0;
      return Math.round(parseFloat(s.replace('s', '')) * 1000);
    };

    for (const word of words) {
      const speaker = word.speaker ?? 'spk_0';
      const startMs = parseOffset(word.start_offset);
      const endMs = parseOffset(word.end_offset);

      if (speaker !== currentSpeaker) {
        if (currentSpeaker !== null && currentWords.length > 0) {
          turns.push({
            speakerLabel: formatSpeaker(currentSpeaker),
            startMs: currentStart,
            endMs: currentEnd,
            text: currentWords.join(' ').trim(),
          });
        }
        currentSpeaker = speaker;
        currentWords = [word.text];
        currentStart = startMs;
        currentEnd = endMs;
      } else {
        currentWords.push(word.text);
        currentEnd = endMs;
      }
    }
    if (currentSpeaker !== null && currentWords.length > 0) {
      turns.push({
        speakerLabel: formatSpeaker(currentSpeaker),
        startMs: currentStart,
        endMs: currentEnd,
        text: currentWords.join(' ').trim(),
      });
    }

    return [{ chunkIndex: 0, turns, usage }];
  }

  private async uploadFile(
    filePath: string,
    fileBuffer: Buffer,
    mimeType: string,
    signal: AbortSignal
  ): Promise<string> {
    // Two-step resumable upload to Files API.
    // Step 1: initiate — get the resumable upload URL.
    const initiateResp = await fetch(`${FILES_API_URL}?uploadType=resumable`, {
      method: 'POST',
      headers: {
        'x-goog-api-key': this.apiKey,
        'Content-Type': 'application/json',
        'X-Goog-Upload-Protocol': 'resumable',
        'X-Goog-Upload-Command': 'start',
        'X-Goog-Upload-Header-Content-Length': String(fileBuffer.length),
        'X-Goog-Upload-Header-Content-Type': mimeType,
      },
      body: JSON.stringify({ file: { displayName: path.basename(filePath) } }),
      signal,
    });

    if (!initiateResp.ok) {
      throw new Error(`Google File API initiate failed: HTTP ${initiateResp.status}`);
    }

    const uploadUrl = initiateResp.headers.get('x-goog-upload-url');
    if (!uploadUrl) throw new Error('Google File API: no upload URL in response');

    // Step 2: upload file data.
    const uploadResp = await fetch(uploadUrl, {
      method: 'POST',
      headers: {
        'Content-Type': mimeType,
        'X-Goog-Upload-Offset': '0',
        'X-Goog-Upload-Command': 'upload, finalize',
      },
      // A Node Buffer is not a BodyInit. Wrap it in a view rather than casting the
      // whole body: the offset and length matter because readFileSync can return a
      // slice of a pooled ArrayBuffer, and new Uint8Array(buf.buffer) would then
      // upload the entire pool. The buffer cast narrows ArrayBufferLike to the
      // ArrayBuffer that BodyInit requires; a file read is never backed by a
      // SharedArrayBuffer.
      body: new Uint8Array(
        fileBuffer.buffer as ArrayBuffer, fileBuffer.byteOffset, fileBuffer.byteLength),
      signal,
    });

    if (!uploadResp.ok) {
      throw new Error(`Google File API upload failed: HTTP ${uploadResp.status}`);
    }

    const fileInfo = (await uploadResp.json()) as { file?: { uri?: string } };
    const fileUri = fileInfo.file?.uri;
    if (!fileUri) throw new Error('Google File API: no file URI in upload response');

    log.info(`Google: file uploaded, URI: ${fileUri}`);
    return fileUri;
  }
}

// Convert "spk_1" → "Speaker 1", "spk_0" → "Speaker 0", etc.
// Falls back to the raw label for unexpected formats.
function formatSpeaker(raw: string): string {
  const m = raw.match(/^spk_(\d+)$/);
  return m ? `Speaker ${m[1]}` : raw;
}
