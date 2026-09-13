import { AssemblyAIProvider } from './assemblyai';
import { ElevenLabsProvider } from './elevenlabs';
import { OpenAIProvider } from './openai';
import { GoogleProvider } from './google';
import { getSecretPlaintext } from '../settings/store';
import { SECRET_KEY_NAMES } from '../../shared/ipc-types';
import type { TranscriptionProvider } from './types';
import type { ProviderName } from '../../shared/ipc-types';

export function getProvider(providerName: ProviderName): TranscriptionProvider {
  const keyName = SECRET_KEY_NAMES[providerName];
  const apiKey = getSecretPlaintext(keyName);
  if (!apiKey) throw new Error(`API key not configured for provider: ${providerName}. Go to Settings to add it.`);

  switch (providerName) {
    case 'assemblyai': return new AssemblyAIProvider(apiKey);
    case 'elevenlabs': return new ElevenLabsProvider(apiKey);
    case 'openai': return new OpenAIProvider(apiKey);
    case 'google': return new GoogleProvider(apiKey);
    default: throw new Error(`Provider not implemented: ${providerName}`);
  }
}
