import type { TranscriptionProvider, TranscriptionOptions, TranscriptChunkResult, SpeakerTurn, ProviderUsage } from './types';
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

    const ext = path.extname(filename).toLowerCase();
    const mimeType: Record<string, string> = {
      '.mp3': 'audio/mpeg', '.mp4': 'audio/mp4', '.m4a': 'audio/mp4',
      '.wav': 'audio/wav', '.ogg': 'audio/ogg', '.webm': 'audio/webm',
    };
    const formData = new FormData();
    formData.append('file', new Blob([fileBuffer], { type: mimeType[ext] ?? 'audio/mpeg' }), filename);
    formData.append('model_id', 'scribe_v2');
    if (options.diarize) formData.append('diarize', 'true');
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
      audio_duration_secs?: number;
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

    let usage: ProviderUsage | undefined;
    try {
      // Real-call verification (Phase 5) found no audio_duration_secs (or any duration
      // field) in a real v1/speech-to-text response — for that request shape (no
      // diarize/language_code, silent fixture audio), the plan's "always present by
      // contract" assumption did not hold. Degrade the same way as OpenAI/Google rather
      // than defaulting to 0, which would silently compute as $0 for a real paid call.
      if (typeof result.audio_duration_secs === 'number') {
        usage = { kind: 'duration', seconds: result.audio_duration_secs };
      } else {
        log.warn(`ElevenLabs transcribe: no audio_duration_secs field in response (${filename}) — cost will be unknown for this call`);
      }
    } catch (err) {
      log.warn(`ElevenLabs transcribe: error deriving usage from response (${filename}) — cost will be unknown for this call`, err);
    }

    return [{ chunkIndex: 0, turns, usage }];
  }
}
