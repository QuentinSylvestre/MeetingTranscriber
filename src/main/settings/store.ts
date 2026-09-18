import { app, safeStorage } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import log from 'electron-log';
import type { Preferences, PreferenceKey, ProviderName } from '../../shared/ipc-types';
import { SECRET_KEY_NAMES } from '../../shared/ipc-types';

// Warning: DEFAULT_PREFERENCES references app.getPath() at module initialization time.
// This module must not be imported before app.whenReady() has been called.
// In src/main/index.ts it is imported via registerAllHandlers() which is inside app.whenReady().
const DEFAULT_PREFERENCES: Preferences = {
  recordingsFolder: path.join(app.getPath('documents'), 'MeetingTranscriber'),
  defaultLanguage: 'fr',   // changed from 'auto'
  defaultProvider: 'assemblyai',
  appLanguage: 'fr',
  includeTimestamps: true,
  fontSize: 18, // default; UI options defined in Phase 3 (SettingsView font size select)
};

function getSecretsPath(): string {
  return path.join(app.getPath('userData'), 'secrets.json');
}

function getPreferencesPath(): string {
  return path.join(app.getPath('userData'), 'preferences.json');
}

// M1: Validate key against the SECRET_KEY_NAMES allowlist to prevent prototype pollution.
const VALID_SECRET_KEYS = new Set(Object.values(SECRET_KEY_NAMES));

function assertValidSecretKey(key: string): void {
  if (!VALID_SECRET_KEYS.has(key)) {
    throw new Error(`Invalid secret key: ${key}`);
  }
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

// M4: Atomic write — write to .tmp then rename to prevent partial-write corruption.
function writeSecrets(secrets: Record<string, string>): void {
  const p = getSecretsPath();
  const tmp = `${p}.tmp`;
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(tmp, JSON.stringify(secrets, null, 2), 'utf-8');
  fs.renameSync(tmp, p);
}

export function hasSecret(key: string): boolean {
  // M1: validate key to prevent prototype pollution
  assertValidSecretKey(key);
  const secrets = readSecrets();
  return Boolean(secrets[key]);
}

// S4: Returns a structured result so the renderer can detect encryption failures.
export function setSecret(key: string, value: string): { success: boolean; error?: string } {
  // M1: validate key to prevent prototype pollution
  assertValidSecretKey(key);
  if (!safeStorage.isEncryptionAvailable()) {
    log.warn('safeStorage encryption unavailable; cannot store secret');
    return { success: false, error: 'encryption_unavailable' };
  }
  try {
    const encrypted = safeStorage.encryptString(value).toString('hex');
    const secrets = readSecrets();
    secrets[key] = encrypted;
    writeSecrets(secrets);
    log.info(`Secret stored for key: ${key}`);
    return { success: true };
  } catch (err) {
    log.error(`Failed to store secret for key ${key}:`, err);
    return { success: false, error: String(err) };
  }
}

export function getSecretPlaintext(key: string): string | null {
  // INTERNAL USE ONLY — called from main process for API requests.
  // NEVER exposed via IPC to renderer.
  // M1: validate key to prevent prototype pollution
  assertValidSecretKey(key);
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

// L3: No in-memory cache for secrets — 4 disk reads on settings-page load is acceptable.
// Adding a cache would require careful invalidation logic; deferred until profiling justifies it.

export async function testSecret(key: string, provider: ProviderName): Promise<{ valid: boolean; error?: string }> {
  // M1: validate key to prevent prototype pollution
  assertValidSecretKey(key);
  const plaintext = getSecretPlaintext(key);
  if (!plaintext) {
    return { valid: false, error: 'API key not configured' };
  }
  try {
    switch (provider) {
      case 'assemblyai': {
        const resp = await fetch('https://api.assemblyai.com/v2/account', {
          headers: { Authorization: plaintext },
          signal: AbortSignal.timeout(10_000), // S5: prevent indefinite hang
        });
        if (!resp.ok) return { valid: false, error: `HTTP ${resp.status}` };
        return { valid: true };
      }
      case 'elevenlabs': {
        const resp = await fetch('https://api.elevenlabs.io/v1/user', {
          headers: { 'xi-api-key': plaintext },
          signal: AbortSignal.timeout(10_000), // S5: prevent indefinite hang
        });
        if (!resp.ok) return { valid: false, error: `HTTP ${resp.status}` };
        return { valid: true };
      }
      case 'openai': {
        const resp = await fetch('https://api.openai.com/v1/models', {
          headers: { Authorization: `Bearer ${plaintext}` },
          signal: AbortSignal.timeout(10_000), // S5: prevent indefinite hang
        });
        if (!resp.ok) return { valid: false, error: `HTTP ${resp.status}` };
        return { valid: true };
      }
      case 'google': {
        // S1: Use header instead of query param to keep key out of server/proxy logs.
        const resp = await fetch(
          'https://generativelanguage.googleapis.com/v1beta/models',
          {
            headers: { 'x-goog-api-key': plaintext },
            signal: AbortSignal.timeout(10_000), // S5: prevent indefinite hang
          }
        );
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
