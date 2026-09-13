// ALL IPC channels declared here. Never use string literals elsewhere.

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
