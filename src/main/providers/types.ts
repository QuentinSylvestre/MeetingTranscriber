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
  /**
   * Always 0: the adapter processes one audio file at a time.
   * The runner assigns the real chunk index via the loop variable i,
   * not from this field. The chunkIndex here is reserved for future
   * adapters that might return multiple result groups per file.
   */
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
