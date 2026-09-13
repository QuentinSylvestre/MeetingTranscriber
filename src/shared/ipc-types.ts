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
}

export interface TranscriptTurn {
  id: string;
  job_id: string;
  chunk_index: number;
  speaker_label: string;
  start_ms: number; // absolute from recording start
  end_ms: number;
  text: string;
}

export interface SpeakerMapping {
  job_id: string;
  chunk_index: number;
  speaker_label: string;
  display_name: string;
}

export interface ChunkResult {
  paths: string[];
  chunkDurationMs: number; // duration per chunk in ms (Infinity if no chunking)
}

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
  // app:reload used by ErrorBoundary (Phase 9)
  'app:reload': {
    request: void;
    response: void;
  };

  // Database channels (Phase 3)
  'db:create-job': {
    request: { job: Omit<Job, 'status' | 'error_msg'> & { status?: JobStatus } };
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
  // Sent via mainWindow.webContents.send('transcription:progress', { jobId, status }).

  // Export channels (Phase 8)
  'export:to-file': {
    request: { jobId: string };
    response: { exported: boolean; filePath?: string };
  };
  'export:to-clipboard': {
    request: { jobId: string };
    response: { copied: boolean };
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

export type PreferenceKey = 'recordingsFolder' | 'defaultLanguage';

export interface Preferences {
  recordingsFolder: string;
  defaultLanguage: 'fr' | 'en' | 'auto';
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
