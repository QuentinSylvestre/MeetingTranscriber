export interface TranscriptionOptions {
  language: 'fr' | 'en' | 'auto';
  diarize: boolean;
}

export interface SpeakerTurn {
  speakerLabel: string; // normalized: 'Speaker A', 'Speaker 0', etc.
  startMs: number; // chunk-relative from the provider; runner applies offset before DB write
  endMs: number;
  text: string;
}

export interface TranscriptChunkResult {
  chunkIndex: number;
  turns: SpeakerTurn[];
}

export interface TranscriptionProvider {
  name: string;
  transcribeFile(
    filePath: string,
    options: TranscriptionOptions,
    onProgress: (status: string) => void,
    signal: AbortSignal
  ): Promise<TranscriptChunkResult[]>;
}
