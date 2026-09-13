import * as fs from 'fs';
import * as path from 'path';
import log from 'electron-log';
import type { TranscriptionProvider, TranscriptionOptions, TranscriptChunkResult, SpeakerTurn } from './types';

const OPENAI_TRANSCRIBE_URL = 'https://api.openai.com/v1/audio/transcriptions';
const MODEL = 'gpt-4o-transcribe-diarize';

export class OpenAIProvider implements TranscriptionProvider {
  name = 'openai';

  constructor(private readonly apiKey: string) {}

  async transcribeFile(
    filePath: string,
    options: TranscriptionOptions,
    onProgress: (status: string) => void,
    signal: AbortSignal
  ): Promise<TranscriptChunkResult[]> {
    onProgress('Transcribing...');

    const fileBuffer = fs.readFileSync(filePath);
    const filename = path.basename(filePath);
    const fileSizeMb = Math.round(fileBuffer.length / 1024 / 1024);

    // OpenAI hard limit: 25 MB. The chunker uses 1000s which is ~15 MB at 128 kbps.
    // Log a warning if a chunk is unexpectedly large.
    if (fileSizeMb > 20) {
      log.warn(`OpenAI: chunk ${filename} is ${fileSizeMb} MB (soft limit 20 MB)`);
    }

    const formData = new FormData();
    formData.append('file', new Blob([fileBuffer], { type: 'audio/mpeg' }), filename);
    formData.append('model', MODEL);
    formData.append('response_format', 'verbose_json');
    if (options.language !== 'auto') formData.append('language', options.language);
    // Diarization is intrinsic to the model name; no separate parameter needed

    const resp = await fetch(OPENAI_TRANSCRIBE_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.apiKey}` },
      body: formData,
      signal,
    });

    if (!resp.ok) {
      const errText = await resp.text().catch(() => '');
      throw new Error(`OpenAI transcription failed: HTTP ${resp.status} ${errText.slice(0, 200)}`);
    }

    const result = (await resp.json()) as {
      segments?: Array<{ speaker?: string; start: number; end: number; text: string }>;
    };

    onProgress('Complete');
    log.info(`OpenAI: ${result.segments?.length ?? 0} segments, ${filename}`);

    // Return plain 'Speaker X' labels — runner.ts applies the 'Chunk N \u2013 ' prefix
    // for multi-chunk jobs (needsChunkPrefix logic).
    const turns: SpeakerTurn[] = (result.segments ?? []).map((seg) => ({
      speakerLabel: `Speaker ${seg.speaker ?? '0'}`,
      startMs: Math.round(seg.start * 1000),
      endMs: Math.round(seg.end * 1000),
      text: seg.text.trim(),
    }));

    return [{ chunkIndex: 0, turns }];
  }
}
