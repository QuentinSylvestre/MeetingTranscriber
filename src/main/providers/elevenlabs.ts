import type { TranscriptionProvider, TranscriptionOptions, TranscriptChunkResult, SpeakerTurn } from './types';
import * as fs from 'fs';
import * as path from 'path';
import log from 'electron-log';

export class ElevenLabsProvider implements TranscriptionProvider {
  name = 'elevenlabs';

  constructor(private readonly apiKey: string) {}

  async transcribeFile(
    filePath: string,
    options: TranscriptionOptions,
    onProgress: (status: string) => void,
    signal: AbortSignal
  ): Promise<TranscriptChunkResult[]> {
    onProgress('Uploading and transcribing...');

    const fileBuffer = fs.readFileSync(filePath);
    const filename = path.basename(filePath);

    const formData = new FormData();
    formData.append('file', new Blob([fileBuffer], { type: 'audio/mpeg' }), filename);
    formData.append('model_id', 'scribe_v2');
    if (options.diarize) formData.append('diarization', 'true');
    if (options.language !== 'auto') formData.append('language_code', options.language);

    const resp = await fetch('https://api.elevenlabs.io/v1/speech-to-text', {
      method: 'POST',
      headers: { 'xi-api-key': this.apiKey },
      body: formData,
      signal,
    });

    if (!resp.ok) {
      const errText = await resp.text().catch(() => '');
      throw new Error(`ElevenLabs transcription failed: HTTP ${resp.status} ${errText.slice(0, 200)}`);
    }

    const result = (await resp.json()) as {
      words?: Array<{
        type: string;
        speaker_id?: number;
        text: string;
        start?: number;
        end?: number;
      }>;
    };

    onProgress('Complete');
    log.info(`ElevenLabs transcription complete: ${result.words?.length ?? 0} words`);

    // Group consecutive words by speaker into turns
    const turns: SpeakerTurn[] = [];
    let currentSpeaker: string | null = null;
    let currentWords: string[] = [];
    let currentStart = 0;
    let currentEnd = 0;

    for (const word of result.words ?? []) {
      if (word.type === 'spacing') continue;
      const speakerLabel = word.speaker_id !== undefined ? `Speaker ${word.speaker_id}` : 'Speaker 0';
      const startMs = Math.round((word.start ?? 0) * 1000);
      const endMs = Math.round((word.end ?? 0) * 1000);

      if (speakerLabel !== currentSpeaker) {
        if (currentSpeaker !== null && currentWords.length > 0) {
          turns.push({
            speakerLabel: currentSpeaker,
            startMs: currentStart,
            endMs: currentEnd,
            text: currentWords.join(' ').trim(),
          });
        }
        currentSpeaker = speakerLabel;
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
        speakerLabel: currentSpeaker,
        startMs: currentStart,
        endMs: currentEnd,
        text: currentWords.join(' ').trim(),
      });
    }

    return [{ chunkIndex: 0, turns }];
  }
}
