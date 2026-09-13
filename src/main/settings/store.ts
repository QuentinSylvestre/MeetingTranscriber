import { app, safeStorage } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import log from 'electron-log';
import type { Preferences, PreferenceKey, ProviderName } from '../../shared/ipc-types';

const DEFAULT_PREFERENCES: Preferences = {
  recordingsFolder: path.join(app.getPath('documents'), 'MeetingTranscriber'),
  defaultLanguage: 'auto',
};

function getSecretsPath(): string {
  return path.join(app.getPath('userData'), 'secrets.json');
}

function getPreferencesPath(): string {
  return path.join(app.getPath('userData'), 'preferences.json');
}

function readSecrets(): Record<string, string> {
  const p = getSecretsPath();
  if (!fs.existsSync(p)) return {};
  try {
    return JSON.parse(fs.readFileSync(p, 'utf-8')) as Record<string, string>;
  } catch {
    log.error('Failed to parse secrets.json; starting with empty secrets');
    return {};
  }
}

function writeSecrets(secrets: Record<string, string>): void {
  const p = getSecretsPath();
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(secrets, null, 2), 'utf-8');
}

export function hasSecret(key: string): boolean {
  const secrets = readSecrets();
  return Boolean(secrets[key]);
}

export function setSecret(key: string, value: string): void {
  if (!safeStorage.isEncryptionAvailable()) {
    log.warn('safeStorage encryption unavailable; storing key name only, not value');
    // Do not throw — degrade gracefully
    return;
  }
  const encrypted = safeStorage.encryptString(value).toString('hex');
  const secrets = readSecrets();
  secrets[key] = encrypted;
  writeSecrets(secrets);
  log.info(`Secret stored for key: ${key}`);
}

export function getSecretPlaintext(key: string): string | null {
  // INTERNAL USE ONLY — called from main process for API requests.
  // NEVER exposed via IPC to renderer.
  const secrets = readSecrets();
  const encrypted = secrets[key];
  if (!encrypted) return null;
  try {
    return safeStorage.decryptString(Buffer.from(encrypted, 'hex'));
  } catch (err) {
    log.error(`Failed to decrypt secret for key ${key}:`, err);
    return null;
  }
}

export function readPreferences(): Preferences {
  const p = getPreferencesPath();
  if (!fs.existsSync(p)) return { ...DEFAULT_PREFERENCES };
  try {
    const raw = JSON.parse(fs.readFileSync(p, 'utf-8')) as Partial<Preferences>;
    return { ...DEFAULT_PREFERENCES, ...raw };
  } catch {
    log.error('Failed to parse preferences.json; using defaults');
    return { ...DEFAULT_PREFERENCES };
  }
}

export function getPreference<K extends PreferenceKey>(key: K): Preferences[K] {
  return readPreferences()[key];
}

export function setPreference<K extends PreferenceKey>(key: K, value: Preferences[K]): void {
  const prefs = readPreferences();
  prefs[key] = value;
  const p = getPreferencesPath();
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(prefs, null, 2), 'utf-8');
  log.info(`Preference set: ${key}`);
}

export async function testSecret(key: string, provider: ProviderName): Promise<{ valid: boolean; error?: string }> {
  const plaintext = getSecretPlaintext(key);
  if (!plaintext) {
    return { valid: false, error: 'API key not configured' };
  }
  try {
    switch (provider) {
      case 'assemblyai': {
        const resp = await fetch('https://api.assemblyai.com/v2/account', {
          headers: { Authorization: plaintext },
        });
        if (!resp.ok) return { valid: false, error: `HTTP ${resp.status}` };
        return { valid: true };
      }
      case 'elevenlabs': {
        const resp = await fetch('https://api.elevenlabs.io/v1/user', {
          headers: { 'xi-api-key': plaintext },
        });
        if (!resp.ok) return { valid: false, error: `HTTP ${resp.status}` };
        return { valid: true };
      }
      case 'openai': {
        const resp = await fetch('https://api.openai.com/v1/models', {
          headers: { Authorization: `Bearer ${plaintext}` },
        });
        if (!resp.ok) return { valid: false, error: `HTTP ${resp.status}` };
        return { valid: true };
      }
      case 'google': {
        // Google generative AI: GET models endpoint with API key
        const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(plaintext)}`;
        const resp = await fetch(url);
        if (!resp.ok) return { valid: false, error: `HTTP ${resp.status}` };
        return { valid: true };
      }
      default:
        return { valid: false, error: 'Unknown provider' };
    }
  } catch (err) {
    return { valid: false, error: String(err) };
  }
}
