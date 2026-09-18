import type { SpeakerCountHint } from '../../shared/ipc-types';

export interface TranscriptionOptions {
  language: 'fr' | 'en' | 'auto';
  diarize: boolean;
  /** Optional natural-language guidance passed to providers that support it (e.g. AssemblyAI U3.5 Pro). */
  prompt?: string;
  /** Optional speaker-count hint, currently read only by assemblyai.ts. */
  speakerCountHint?: SpeakerCountHint;
  /**
   * Threaded through purely for log correlation: runner.ts always has the job id
   * available at its one transcribeFile() call site and passes it here so each
   * adapter's usage-derivation warnings can log it alongside the chunk filename,
   * matching the `Job ${jobId}: ...` correlator runner.ts's own cost/duration
   * warnings already use. Optional (rather than a new required parameter) so
   * this stays additive and doesn't ripple into every existing call site.
   */
  jobId?: string;
}

export interface SpeakerTurn {
  speakerLabel: string; // normalized: 'Speaker A', 'Speaker 0', etc.
  startMs: number; // chunk-relative from the provider; runner applies offset before DB write
  endMs: number;
  text: string;
}

export type ProviderUsage =
  | { kind: 'duration'; seconds: number; modelUsed?: string }
  | { kind: 'tokens'; inputTokens: number; outputTokens: number; audioTokens?: number; cachedTokens?: number };

export interface TranscriptChunkResult {
  /**
   * Always 0: the adapter processes one audio file at a time.
   * The runner assigns the real chunk index via the loop variable i,
   * not from this field. The chunkIndex here is reserved for future
   * adapters that might return multiple result groups per file.
   */
  chunkIndex: number;
  turns: SpeakerTurn[];
  /**
   * Provider's already-available billing data for this call. Absent when the
   * provider's response didn't include the expected usage field — callers must
   * not default a missing usage to a computed cost of zero (see assemblyai.ts,
   * elevenlabs.ts, openai.ts, google.ts — all four adapters follow this
   * log-and-omit convention).
   */
  usage?: ProviderUsage;
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
