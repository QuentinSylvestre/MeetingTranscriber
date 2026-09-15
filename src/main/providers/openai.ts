import * as fs from 'fs';
import * as path from 'path';
import log from 'electron-log';
import type { TranscriptionProvider, TranscriptionOptions, TranscriptChunkResult, SpeakerTurn } from './types';

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

    // diarized_json response: { segments: [{ speaker, start, end, text }] }
    const result = (await resp.json()) as {
      segments?: Array<{ speaker?: string; start: number; end: number; text: string }>;
    };

    onProgress('Complete');
    log.info(`OpenAI diarize: ${result.segments?.length ?? 0} segments, ${filename}`);

    const turns: SpeakerTurn[] = (result.segments ?? []).map((seg) => ({
      speakerLabel: `Speaker ${seg.speaker ?? '0'}`,
      startMs: Math.round(seg.start * 1000),
      endMs: Math.round(seg.end * 1000),
      text: seg.text.trim(),
    }));

    return [{ chunkIndex: 0, turns }];
  }
}
