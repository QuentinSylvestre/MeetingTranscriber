// ALL IPC channels declared here. Never use string literals elsewhere.

export type JobStatus = 'pending' | 'uploading' | 'transcribing' | 'done' | 'failed';

export interface Job {
  id: string;
  title: string;
  created_at: number; // Unix ms
  audio_path: string;
  duration_s: number | null;
  provider: ProviderName;
  model: string;
  language: 'fr' | 'en' | 'auto';
  status: JobStatus;
  error_msg: string | null;
  chunk_count: number;
  cost_usd: number | null;
}

export interface TranscriptTurn {
  id: string;
  job_id: string;
  chunk_index: number;
  speaker_label: string;
  start_ms: number; // absolute from recording start
  end_ms: number;
  text: string;
  original_text: string;
}

export interface SpeakerMapping {
  job_id: string;
  chunk_index: number;
  speaker_label: string;
  display_name: string;
}

export type SpeakerCountHint =
  | { mode: 'exact'; count: number }
  | { mode: 'range'; min: number; max: number };

export interface ChunkResult {
  paths: string[];
  chunkDurationMs: number; // duration per chunk in ms (Infinity if no chunking)
}

export type SummaryErrorCode = 'missing_key' | 'empty_transcript' | 'invalid_summary' |
  'refused' | 'incomplete' | 'timeout' | 'provider_error' | 'busy' | 'save_failed' |
  'open_failed' | 'transcript_too_long' | 'bad_extension' | 'render_failed' |
  'persist_failed' | 'no_stored_summary' | 'rerender_failed';
/** Single source of truth for the summary model id: main sends it, the UI names it. */
export const SUMMARY_MODEL = 'gpt-5.6-sol';
export type SummaryResult = { status: 'saved'; filePath: string } | { status: 'canceled' } |
  { status: 'error'; error: SummaryErrorCode };
// hasStoredSummary marks a job whose validated summary JSON + transcript snapshot are
// durably persisted (job_summaries), so 'summary:rerender' can re-render/re-save its
// docx at any time — including after a restart — without a new provider request.
export interface SummaryStateResult { filePath: string | null; hasStoredSummary: boolean; busy: boolean }

// Settings channels
export interface IpcChannels {
  'settings:has-secret': {
    // `key` is a secret identifier string (e.g. 'api_key_assemblyai').
    request: { key: string };
    response: { present: boolean };
  };
  'settings:set-secret': {
    // `key` is a secret identifier string (e.g. 'api_key_assemblyai').
    request: { key: string; value: string };
    response: { success: boolean; error?: string };
  };
  'settings:test-secret': {
    // `key` is a secret identifier string (e.g. 'api_key_assemblyai').
    request: { key: string; provider: ProviderName };
    response: { valid: boolean; error?: string };
  };
  'settings:get-preference': {
    // `key` is a PreferenceKey enum value (e.g. 'recordingsFolder', 'defaultLanguage').
    request: { key: PreferenceKey };
    response: { value: unknown };
  };
  'settings:set-preference': {
    // `key` is a PreferenceKey enum value (e.g. 'recordingsFolder', 'defaultLanguage').
    request: { key: PreferenceKey; value: unknown };
    response: void;
  };
  'settings:copy-upload': {
    // Copy an externally-browsed file into the recordings folder.
    // Returns the destination absolute path.
    request: { srcPath: string; jobId: string; fileName: string };
    response: string;
  };
  'settings:pick-audio-file': {
    // Open a native file picker dialog; returns the selected absolute path or null if cancelled.
    request: { extensions: string[] };
    response: string | null;
  };
  // app:reload used by ErrorBoundary (Phase 9)
  'app:reload': {
    request: void;
    response: void;
  };

  // Database channels (Phase 3)
  'db:create-job': {
    request: { job: Omit<Job, 'status' | 'error_msg' | 'cost_usd'> & { status?: JobStatus } };
    response: void;
  };
  'db:update-job-status': {
    request: { id: string; status: JobStatus; error_msg?: string; duration_s?: number };
    response: void;
  };
  'db:get-job': {
    request: { id: string };
    response: Job | null;
  };
  'db:list-jobs': {
    request: void;
    response: Job[];
  };
  'db:delete-job': {
    request: { id: string };
    response: void;
  };
  'db:update-job-title': {
    request: { id: string; title: string };
    response: void;
  };
  'db:save-transcript': {
    request: { turns: TranscriptTurn[] };
    response: void;
  };
  'db:get-transcript': {
    request: { job_id: string };
    response: TranscriptTurn[];
  };
  'db:update-speaker-mapping': {
    request: { job_id: string; chunk_index: number; speaker_label: string; display_name: string };
    response: void;
  };
  'db:get-speaker-mappings': {
    request: { job_id: string };
    response: SpeakerMapping[];
  };
  'db:update-turn-text': {
    request: { id: string; text: string };
    response: void;
  };
  'db:reset-transcript': {
    request: { job_id: string };
    response: TranscriptTurn[];
  };

  // Recorder channels (Phase 4)
  'recorder:start': {
    // audioPath is now built in the main process from recordingsFolder + jobId.
    // The renderer only needs to pass jobId and optional micDeviceId.
    request: { jobId: string; micDeviceId?: string; enableLoopback?: boolean };
    response: void;
  };
  'recorder:pause': {
    request: void;
    response: void;
  };
  'recorder:resume': {
    request: void;
    response: void;
  };
  'recorder:stop': {
    request: void;
    // Returns the absolute audioPath so the renderer can hand it to transcription:start-job.
    response: { audioPath: string | null };
  };
  'recorder:get-devices': {
    request: void;
    response: { id: string; label: string }[];
  };
  // 'recorder:pcm-chunk' is an invoke channel used for IPC-batched PCM forwarding.
  // The AudioWorklet batches ~50ms of PCM and sends via ipcRenderer.invoke.
  'recorder:pcm-chunk': {
    request: { chunk: number[] };
    response: void;
  };

  // Chunker channels (Phase 5)
  'chunker:split': {
    request: {
      inputPath: string;
      provider: ProviderName;
      outputDir: string;
    };
    response: ChunkResult;
  };

  // Transcription channels (Phase 6)
  'transcription:start-job': {
    request: {
      jobId: string;
      title: string;
      audioPath: string;
      provider: ProviderName;
      model: string;
      language: 'fr' | 'en' | 'auto';
      durationS?: number;
      speakerCountHint?: SpeakerCountHint;
    };
    response: void;
  };
  'transcription:cancel-job': {
    request: void;
    response: void;
  };
  'transcription:get-progress': {
    request: { jobId: string };
    response: { status: string; jobId: string };
  };
  // Push event (main → renderer): 'transcription:progress'
  // Sent via mainWindow.webContents.send('transcription:progress', { jobId, status, costUsd }).
  // costUsd is present once a provider call has reported its own billing/duration data
  // for this job; it is absent (never 0) on every progress event sent before that point,
  // and on events (Done/Cancelled/Error:) that carry no usage of their own — consumers
  // must keep showing the last-received value rather than treat "absent" as "zero".

  // Export channels (Phase 8)
  'export:to-file': {
    request: { jobId: string };
    response: { exported: boolean; filePath?: string };
  };
  'export:to-clipboard': {
    request: { jobId: string };
    response: { copied: boolean };
  };
  'summary:generate': {
    request: { jobId: string };
    response: SummaryResult;
  };
  'summary:rerender': {
    request: { jobId: string };
    response: SummaryResult;
  };
  'summary:state': {
    request: { jobId: string };
    response: SummaryStateResult;
  };
  'summary:open': {
    request: { jobId: string };
    response: { opened: boolean };
  };
}

// Push event (main → renderer): NOT an invoke channel.
// Sent via mainWindow.webContents.send('recorder:progress', payload).
export interface RecorderProgress {
  durationMs: number;
  status: 'recording' | 'paused' | 'stopped';
}

// Derived type — always in sync with IpcChannels, no manual maintenance needed.
export type InvokeChannel = keyof IpcChannels;

export type ProviderName = 'assemblyai' | 'elevenlabs' | 'openai' | 'google';

export type PreferenceKey = 'recordingsFolder' | 'defaultLanguage' | 'defaultProvider' | 'appLanguage' | 'includeTimestamps' | 'fontSize' | 'pricingRates';

export interface Preferences {
  recordingsFolder: string;
  defaultLanguage: 'fr' | 'en' | 'auto';
  defaultProvider: ProviderName;
  appLanguage: 'fr' | 'en';
  includeTimestamps: boolean;
  fontSize: number;
  pricingRates: PricingRates;
}

// Per-provider (and, for AssemblyAI, per-tier) billing rates used to compute exact
// API cost from each provider's own inline usage/duration field. User-editable in
// Settings — rates drift over time (promotional pricing expires, pages go stale),
// so these live as a preference rather than a hardcoded constant.
export interface PricingRates {
  assemblyai: { universal35ProPerHourUsd: number; universal2PerHourUsd: number; diarizationPerHourUsd: number };
  elevenlabs: { perHourUsd: number };
  openaiTranscribe: { inputPerMillionUsd: number; outputPerMillionUsd: number };
  openaiSummary: { inputPerMillionUsd: number; outputPerMillionUsd: number; cachedInputPerMillionUsd: number };
  google: { inputPerMillionUsd: number; outputPerMillionUsd: number };
}

// Researched defaults as of 2026-09-18. Exported so store.ts's DEFAULT_PREFERENCES
// and SettingsView.tsx's initial React state both reference this one literal —
// never two independently-typed copies of the same numbers.
export const DEFAULT_PRICING_RATES: PricingRates = {
  assemblyai: { universal35ProPerHourUsd: 0.21, universal2PerHourUsd: 0.15, diarizationPerHourUsd: 0.02 },
  elevenlabs: { perHourUsd: 0.22 },
  openaiTranscribe: { inputPerMillionUsd: 2.50, outputPerMillionUsd: 10.00 },
  openaiSummary: { inputPerMillionUsd: 4.00, outputPerMillionUsd: 20.00, cachedInputPerMillionUsd: 0.40 },
  google: { inputPerMillionUsd: 2.00, outputPerMillionUsd: 12.00 },
};

function isFiniteNonNegative(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0;
}

// Runtime type guard for the pricingRates preference. A malformed value here would
// silently produce NaN/wrong displayed costs downstream rather than an obviously
// rejected write, so this checks every leaf (finite, non-negative) and that every
// expected sub-object is present — not just a shallow `typeof value === 'object'`.
//
// Lives here (rather than in src/main/ipc/settings.ts, which imports `electron` and
// can't be reused outside the main process) so both the IPC write-path guard and any
// read-path validation (store.ts's readPreferences, SettingsView's load effect) share
// one definition instead of drifting apart.
export function isValidPricingRates(value: unknown): value is PricingRates {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  const { assemblyai, elevenlabs, openaiTranscribe, openaiSummary, google } = v;
  if (typeof assemblyai !== 'object' || assemblyai === null) return false;
  if (typeof elevenlabs !== 'object' || elevenlabs === null) return false;
  if (typeof openaiTranscribe !== 'object' || openaiTranscribe === null) return false;
  if (typeof openaiSummary !== 'object' || openaiSummary === null) return false;
  if (typeof google !== 'object' || google === null) return false;
  const a = assemblyai as Record<string, unknown>;
  const e = elevenlabs as Record<string, unknown>;
  const ot = openaiTranscribe as Record<string, unknown>;
  const os = openaiSummary as Record<string, unknown>;
  const g = google as Record<string, unknown>;
  return (
    isFiniteNonNegative(a.universal35ProPerHourUsd) &&
    isFiniteNonNegative(a.universal2PerHourUsd) &&
    isFiniteNonNegative(a.diarizationPerHourUsd) &&
    isFiniteNonNegative(e.perHourUsd) &&
    isFiniteNonNegative(ot.inputPerMillionUsd) &&
    isFiniteNonNegative(ot.outputPerMillionUsd) &&
    isFiniteNonNegative(os.inputPerMillionUsd) &&
    isFiniteNonNegative(os.outputPerMillionUsd) &&
    isFiniteNonNegative(os.cachedInputPerMillionUsd) &&
    isFiniteNonNegative(g.inputPerMillionUsd) &&
    isFiniteNonNegative(g.outputPerMillionUsd)
  );
}

export const PROVIDER_NAMES: ProviderName[] = ['assemblyai', 'elevenlabs', 'openai', 'google'];

export const PROVIDER_LABELS: Record<ProviderName, string> = {
  assemblyai: 'AssemblyAI',
  elevenlabs: 'ElevenLabs Scribe v2',
  openai: 'OpenAI gpt-4o-transcribe-diarize',
  google: 'Google Gemini 3.5 Transcribe',
};

export const SECRET_KEY_NAMES: Record<ProviderName, string> = {
  assemblyai: 'api_key_assemblyai',
  elevenlabs: 'api_key_elevenlabs',
  openai: 'api_key_openai',
  google: 'api_key_google',
};
