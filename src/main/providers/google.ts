import * as fs from 'fs';
import log from 'electron-log';
import type { TranscriptionProvider, TranscriptionOptions, TranscriptChunkResult, SpeakerTurn } from './types';

const GEMINI_GENERATE_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-transcribe-preview:generateContent';
const GEMINI_FILE_UPLOAD_URL = 'https://generativelanguage.googleapis.com/upload/v1beta/files';
const BASE64_SIZE_LIMIT = 20_000_000; // 20 MB

export class GoogleProvider implements TranscriptionProvider {
  name = 'google';

  constructor(private readonly apiKey: string) {}

  async transcribeFile(
    filePath: string,
    options: TranscriptionOptions,
    onProgress: (status: string) => void,
    signal: AbortSignal
  ): Promise<TranscriptChunkResult[]> {
    onProgress('Preparing audio...');

    const fileBuffer = fs.readFileSync(filePath);
    let audioPart: Record<string, unknown>;

    if (fileBuffer.length > BASE64_SIZE_LIMIT) {
      // Use File API for large files (> 20 MB)
      log.warn(`Google: file ${filePath} is ${Math.round(fileBuffer.length / 1024 / 1024)} MB, using File API`);
      onProgress('Uploading to File API...');
      const fileUri = await this.uploadGoogleFile(filePath, fileBuffer, signal);
      audioPart = { fileData: { mimeType: 'audio/mp3', fileUri } };
    } else {
      const base64 = fileBuffer.toString('base64');
      audioPart = { inlineData: { mimeType: 'audio/mp3', data: base64 } };
    }

    const languageInstruction = options.language !== 'auto'
      ? ` Transcribe in ${options.language === 'fr' ? 'French' : 'English'}.`
      : '';

    const requestBody = {
      contents: [{
        parts: [
          {
            text: `Transcribe this audio with speaker diarization.${languageInstruction} Return a JSON object with a "utterances" array. Each utterance has: "speaker" (string, e.g. "Speaker 0"), "start" (seconds, float), "end" (seconds, float), "text" (string). Only return the JSON object, no other text.`,
          },
          audioPart,
        ],
      }],
      generationConfig: {
        responseMimeType: 'application/json',
      },
    };

    onProgress('Transcribing...');
    const resp = await fetch(GEMINI_GENERATE_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': this.apiKey, // Use header, not query param
      },
      body: JSON.stringify(requestBody),
      signal,
    });

    if (!resp.ok) {
      const errText = await resp.text().catch(() => '');
      throw new Error(`Google Gemini transcription failed: HTTP ${resp.status} ${errText.slice(0, 200)}`);
    }

    const rawResult = (await resp.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    };

    const textContent = rawResult.candidates?.[0]?.content?.parts?.[0]?.text ?? '{}';
    let parsed: { utterances?: Array<{ speaker: string; start: number; end: number; text: string }> };
    try {
      parsed = JSON.parse(textContent);
    } catch (parseErr) {
      // Model returned non-JSON (possible refusal or unexpected format).
      // responseMimeType: 'application/json' instructs Gemini to return JSON;
      // if it doesn't, something went wrong — treat as a hard error.
      throw new Error(`Google: model returned unparseable response. Fragment: ${textContent.slice(0, 200)}`);
    }

    if (!parsed.utterances || parsed.utterances.length === 0) {
      log.warn('Google: model returned zero utterances (silent recording or model issue)');
      // Don't throw — the audio may be genuinely silent. Return empty results.
    }

    onProgress('Complete');
    log.info(`Google: ${parsed.utterances?.length ?? 0} utterances`);

    // Return plain speaker labels as provided by the model ('Speaker 0', etc.).
    // runner.ts applies the 'Chunk N \u2013 ' prefix for multi-chunk jobs.
    const turns: SpeakerTurn[] = (parsed.utterances ?? []).map((u) => ({
      speakerLabel: u.speaker,
      startMs: Math.round(u.start * 1000),
      endMs: Math.round(u.end * 1000),
      text: u.text,
    }));

    return [{ chunkIndex: 0, turns }];
  }

  private async uploadGoogleFile(
    filePath: string,
    fileBuffer: Buffer,
    signal: AbortSignal
  ): Promise<string> {
    // Two-step File API upload: initiate (resumable) + upload data
    const initiateResp = await fetch(`${GEMINI_FILE_UPLOAD_URL}?uploadType=resumable`, {
      method: 'POST',
      headers: {
        'x-goog-api-key': this.apiKey,
        'Content-Type': 'application/json',
        'X-Goog-Upload-Protocol': 'resumable',
        'X-Goog-Upload-Command': 'start',
        'X-Goog-Upload-Header-Content-Length': String(fileBuffer.length),
        'X-Goog-Upload-Header-Content-Type': 'audio/mp3',
      },
      body: JSON.stringify({ file: { displayName: filePath } }),
      signal,
    });

    if (!initiateResp.ok) {
      throw new Error(`Google File API initiate failed: HTTP ${initiateResp.status}`);
    }

    const uploadUrl = initiateResp.headers.get('x-goog-upload-url');
    if (!uploadUrl) throw new Error('Google File API: no upload URL in response');

    // The resumable upload URL is pre-authenticated by the initiate step;
    // no Authorization or api-key header is needed for the upload PUT/POST.
    const uploadResp = await fetch(uploadUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'audio/mp3',
        'X-Goog-Upload-Offset': '0',
        'X-Goog-Upload-Command': 'upload, finalize',
      },
      body: fileBuffer,
      signal,
    });

    if (!uploadResp.ok) {
      throw new Error(`Google File API upload failed: HTTP ${uploadResp.status}`);
    }

    const fileInfo = (await uploadResp.json()) as { file?: { uri?: string } };
    const fileUri = fileInfo.file?.uri;
    if (!fileUri) throw new Error('Google File API: no file URI in upload response');

    log.info(`Google: File API upload complete, URI: ${fileUri}`);
    return fileUri;
  }
}
