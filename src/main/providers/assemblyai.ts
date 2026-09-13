import * as fs from 'fs';
import type { TranscriptionProvider, TranscriptionOptions, TranscriptChunkResult, SpeakerTurn } from './types';
import log from 'electron-log';

const BASE_URL = 'https://api.assemblyai.com';
export const DEFAULT_POLL_INTERVAL_MS = 5000;

export class AssemblyAIProvider implements TranscriptionProvider {
  name = 'assemblyai';

  constructor(
    private readonly apiKey: string,
    private readonly pollIntervalMs: number = DEFAULT_POLL_INTERVAL_MS
  ) {}

  async transcribeFile(
    filePath: string,
    options: TranscriptionOptions,
    onProgress: (status: string) => void,
    signal: AbortSignal
  ): Promise<TranscriptChunkResult[]> {
    onProgress('Uploading audio...');

    // 1. Upload file
    const fileBuffer = fs.readFileSync(filePath);
    const fileSizeMb = Math.round(fileBuffer.length / 1024 / 1024);
    if (fileSizeMb > 100) {
      log.warn(`AssemblyAI: loading ${fileSizeMb} MB into memory for upload. Consider streaming for large files in a future version.`);
    }
    const uploadResp = await fetch(`${BASE_URL}/v2/upload`, {
      method: 'POST',
      headers: {
        Authorization: this.apiKey,
        'Content-Type': 'application/octet-stream',
      },
      body: fileBuffer,
      signal,
    });
    if (!uploadResp.ok) throw new Error(`AssemblyAI upload failed: HTTP ${uploadResp.status}`);
    const { upload_url } = (await uploadResp.json()) as { upload_url: string };

    // 2. Create transcription request
    const transcriptBody: Record<string, unknown> = {
      audio_url: upload_url,
      // Explicitly request current flagship + fallback model.
      // API default is already ["universal-3-5-pro", "universal-2"] but specifying it
      // makes the intent clear and guards against future default changes.
      speech_models: ['universal-3-5-pro', 'universal-2'],
      speaker_labels: options.diarize,
      language_code: options.language === 'auto' ? undefined : options.language,
      language_detection: options.language === 'auto',
      // Optional natural-language guidance for improved accuracy on domain-specific content.
      // Particularly useful for U3.5 Pro (e.g. "French business meeting with technical vocabulary").
      ...(options.prompt != null && options.prompt.trim() !== '' ? { prompt: options.prompt } : {}),
    };

    const createResp = await fetch(`${BASE_URL}/v2/transcript`, {
      method: 'POST',
      headers: { Authorization: this.apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify(transcriptBody),
      signal,
    });
    if (!createResp.ok) throw new Error(`AssemblyAI create transcript failed: HTTP ${createResp.status}`);
    const { id: transcriptId } = (await createResp.json()) as { id: string };

    onProgress('Transcribing...');
    log.info(`AssemblyAI transcript ID: ${transcriptId}`);

    // 3. Poll until complete
    while (!signal.aborted) {
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, this.pollIntervalMs);
        signal.addEventListener('abort', () => { clearTimeout(timer); resolve(); }, { once: true });
      });
      if (signal.aborted) break;

      const pollResp = await fetch(`${BASE_URL}/v2/transcript/${transcriptId}`, {
        headers: { Authorization: this.apiKey },
        signal,
      });
      if (!pollResp.ok) throw new Error(`AssemblyAI poll failed: HTTP ${pollResp.status}`);
      const result = (await pollResp.json()) as {
        status: string;
        error?: string;
        utterances?: Array<{ speaker: string; start: number; end: number; text: string }>;
      };

      if (result.status === 'error') throw new Error(`AssemblyAI transcription error: ${result.error}`);
      if (result.status === 'completed') {
        onProgress('Complete');
        const turns: SpeakerTurn[] = (result.utterances ?? []).map(u => ({
          speakerLabel: `Speaker ${u.speaker}`, // normalize: 'A' -> 'Speaker A'
          startMs: Math.round(u.start),
          endMs: Math.round(u.end),
          text: u.text,
        }));
        return [{ chunkIndex: 0, turns }];
      }

      onProgress(`Status: ${result.status}`);
    }

    throw new Error('Transcription cancelled');
  }
}
