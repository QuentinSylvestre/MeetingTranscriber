import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock electron modules before importing the store.
// vi.mock calls are hoisted and re-applied after vi.resetModules().
// However, the vi.fn() instances are fresh after each reset — tests that need
// specific return values must re-mock them in the test body.
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
    renameSync: vi.fn(), // M4: needed for atomic write (writeFileSync + renameSync)
  };
});

// Helper: re-apply safeStorage mocks after vi.resetModules().
// resetModules creates fresh vi.fn() instances in the factory, so return values
// must be re-set in each test that needs encryption to work.
async function restoreEncryptionMocks(): Promise<void> {
  const electron = await import('electron');
  vi.mocked(electron.safeStorage.isEncryptionAvailable).mockReturnValue(true);
  vi.mocked(electron.safeStorage.encryptString).mockImplementation((s: string) => Buffer.from(s));
  vi.mocked(electron.safeStorage.decryptString).mockImplementation((b: Buffer) => b.toString());
}

describe('settings/store', () => {
  // M5: resetModules ensures each test gets a fresh module instance, preventing
  // module-level state (e.g. VALID_SECRET_KEYS, cached imports) from leaking.
  // vi.mock factories are re-hoisted so mock shapes persist; return values must
  // be re-applied in each test because vi.fn() instances are freshly created.
  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it('hasSecret returns false when no secrets file', async () => {
    const { hasSecret } = await import('../../src/main/settings/store');
    expect(hasSecret('api_key_assemblyai')).toBe(false);
  });

  it('setSecret and hasSecret round-trip', async () => {
    await restoreEncryptionMocks();
    const fs = await import('fs');
    const { hasSecret, setSecret } = await import('../../src/main/settings/store');

    // Simulate that writeFileSync stores the value and readFileSync returns it on next call.
    // M4: writeSecrets now calls writeFileSync (tmp) then renameSync; we capture from writeFileSync.
    let storedSecrets: Record<string, string> = {};
    vi.mocked(fs.writeFileSync).mockImplementation((_p, data) => {
      storedSecrets = JSON.parse(data as string);
    });
    vi.mocked(fs.readFileSync).mockImplementation(() => JSON.stringify(storedSecrets));
    vi.mocked(fs.existsSync).mockReturnValue(true);

    // S4: setSecret now returns { success, error? }
    const result = setSecret('api_key_assemblyai', 'test-key-value');
    expect(result.success).toBe(true);
    expect(vi.mocked(fs.writeFileSync)).toHaveBeenCalled();
    expect(hasSecret('api_key_assemblyai')).toBe(true);
  });

  it('setSecret returns encryption_unavailable error when safeStorage unavailable', async () => {
    const electron = await import('electron');
    vi.mocked(electron.safeStorage.isEncryptionAvailable).mockReturnValue(false);
    const { setSecret } = await import('../../src/main/settings/store');
    const result = setSecret('api_key_assemblyai', 'test-key-value');
    expect(result.success).toBe(false);
    expect(result.error).toBe('encryption_unavailable');
  });

  it('getSecretPlaintext returns decrypted value', async () => {
    await restoreEncryptionMocks();
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
    expect(prefs.defaultLanguage).toBe('fr');
    expect(typeof prefs.recordingsFolder).toBe('string');
    expect(prefs.defaultProvider).toBe('assemblyai');
    expect(prefs.appLanguage).toBe('fr');
  });

  // testSecret returns 'not configured' when the key exists but has no stored value.
  // Uses a real valid key name (api_key_assemblyai) so assertValidSecretKey passes;
  // existsSync returns false (default) so readSecrets() returns {} and plaintext is null.
  it('testSecret returns error when key not configured', async () => {
    const { testSecret } = await import('../../src/main/settings/store');
    const result = await testSecret('api_key_assemblyai', 'assemblyai');
    expect(result.valid).toBe(false);
    expect(result.error).toContain('not configured');
  });

  // M1: Prototype pollution guard
  it('hasSecret throws on invalid key', async () => {
    const { hasSecret } = await import('../../src/main/settings/store');
    expect(() => hasSecret('__proto__')).toThrow('Invalid secret key');
    expect(() => hasSecret('constructor')).toThrow('Invalid secret key');
  });

  it('setSecret throws on invalid key', async () => {
    const { setSecret } = await import('../../src/main/settings/store');
    expect(() => setSecret('__proto__', 'value')).toThrow('Invalid secret key');
  });

  // M3: testSecret calls the correct endpoint for each provider
  it('testSecret calls the correct endpoint for each provider', async () => {
    await restoreEncryptionMocks();
    const fs = await import('fs');
    const { setSecret, testSecret } = await import('../../src/main/settings/store');

    // Set up a stored key
    let storedSecrets: Record<string, string> = {};
    vi.mocked(fs.writeFileSync).mockImplementation((_p, data) => {
      storedSecrets = JSON.parse(data as string);
    });
    vi.mocked(fs.readFileSync).mockImplementation(() => JSON.stringify(storedSecrets));
    vi.mocked(fs.existsSync).mockReturnValue(true);
    setSecret('api_key_assemblyai', 'test-key');

    // Mock global fetch
    const mockFetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    vi.stubGlobal('fetch', mockFetch);

    await testSecret('api_key_assemblyai', 'assemblyai');
    expect(mockFetch).toHaveBeenCalledWith(
      'https://api.assemblyai.com/v2/account',
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'test-key' }),
      })
    );

    vi.unstubAllGlobals();
  });

  // S1: Google provider uses x-goog-api-key header, not query param
  it('testSecret uses x-goog-api-key header for google (not query param)', async () => {
    await restoreEncryptionMocks();
    const fs = await import('fs');
    const { setSecret, testSecret } = await import('../../src/main/settings/store');

    let storedSecrets: Record<string, string> = {};
    vi.mocked(fs.writeFileSync).mockImplementation((_p, data) => {
      storedSecrets = JSON.parse(data as string);
    });
    vi.mocked(fs.readFileSync).mockImplementation(() => JSON.stringify(storedSecrets));
    vi.mocked(fs.existsSync).mockReturnValue(true);
    setSecret('api_key_google', 'google-test-key');

    const mockFetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    vi.stubGlobal('fetch', mockFetch);

    await testSecret('api_key_google', 'google');
    expect(mockFetch).toHaveBeenCalledOnce();
    const [calledUrl, calledOptions] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(calledUrl).not.toContain('?key=');
    expect((calledOptions.headers as Record<string, string>)['x-goog-api-key']).toBe('google-test-key');

    vi.unstubAllGlobals();
  });
});
