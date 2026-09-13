import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock electron modules before importing the store
vi.mock('electron', () => ({
  app: {
    getPath: vi.fn((key: string) => {
      if (key === 'userData') return '/tmp/test-userdata';
      if (key === 'documents') return '/tmp/test-docs';
      return '/tmp';
    }),
  },
  safeStorage: {
    isEncryptionAvailable: vi.fn(() => true),
    encryptString: vi.fn((s: string) => Buffer.from(s)), // mock: identity
    decryptString: vi.fn((b: Buffer) => b.toString()),   // mock: identity
  },
}));

vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs');
  return {
    ...actual,
    existsSync: vi.fn(() => false),
    readFileSync: vi.fn(() => '{}'),
    writeFileSync: vi.fn(),
    mkdirSync: vi.fn(),
  };
});

describe('settings/store', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('hasSecret returns false when no secrets file', async () => {
    const { hasSecret } = await import('../../src/main/settings/store');
    expect(hasSecret('api_key_assemblyai')).toBe(false);
  });

  it('setSecret and hasSecret round-trip', async () => {
    const fs = await import('fs');
    const { hasSecret, setSecret } = await import('../../src/main/settings/store');

    // Simulate that writeFileSync stores the value and readFileSync returns it on next call
    let storedSecrets: Record<string, string> = {};
    vi.mocked(fs.writeFileSync).mockImplementation((_p, data) => {
      storedSecrets = JSON.parse(data as string);
    });
    vi.mocked(fs.readFileSync).mockImplementation(() => JSON.stringify(storedSecrets));
    vi.mocked(fs.existsSync).mockReturnValue(true);

    setSecret('api_key_assemblyai', 'test-key-value');
    expect(vi.mocked(fs.writeFileSync)).toHaveBeenCalled();
    expect(hasSecret('api_key_assemblyai')).toBe(true);
  });

  it('getSecretPlaintext returns decrypted value', async () => {
    const fs = await import('fs');
    const { setSecret, getSecretPlaintext } = await import('../../src/main/settings/store');

    let storedSecrets: Record<string, string> = {};
    vi.mocked(fs.writeFileSync).mockImplementation((_p, data) => {
      storedSecrets = JSON.parse(data as string);
    });
    vi.mocked(fs.readFileSync).mockImplementation(() => JSON.stringify(storedSecrets));
    vi.mocked(fs.existsSync).mockReturnValue(true);

    setSecret('api_key_openai', 'sk-test-key');
    const value = getSecretPlaintext('api_key_openai');
    expect(value).toBe('sk-test-key');
  });

  it('preferences default schema applied when file missing', async () => {
    const { readPreferences } = await import('../../src/main/settings/store');
    const prefs = readPreferences();
    expect(prefs.defaultLanguage).toBe('auto');
    expect(typeof prefs.recordingsFolder).toBe('string');
  });

  it('testSecret returns error when key not configured', async () => {
    const { testSecret } = await import('../../src/main/settings/store');
    const result = await testSecret('api_key_missing', 'assemblyai');
    expect(result.valid).toBe(false);
    expect(result.error).toContain('not configured');
  });
});
