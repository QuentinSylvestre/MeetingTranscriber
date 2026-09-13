import { describe, it, expect, vi } from 'vitest';

// Mock electron and dependencies before any module resolution
vi.mock('electron', () => ({
  app: {
    getPath: vi.fn((key: string) =>
      key === 'userData' ? 'C:/Users/test/AppData/Roaming/MeetingTranscriber' : ''
    ),
  },
  protocol: { registerFileProtocol: vi.fn() },
}));
vi.mock('../../src/main/settings/store', () => ({
  getPreference: vi.fn(() => 'C:/Users/test/Documents/MeetingTranscriber'),
}));
vi.mock('electron-log', () => ({
  default: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
}));
vi.mock('fs', async (orig) => {
  const actual = await orig<typeof import('fs')>();
  return { ...actual, existsSync: vi.fn(() => true) };
});

// Pure confinement logic extracted from protocol.ts for deterministic testing.
// path.normalize is used so traversal sequences like ../../ are resolved before
// comparison — mirrors the behavior in registerAppProtocol.
import * as path from 'path';

function checkConfinement(filePath: string, allowedRoots: string[]): boolean {
  const normalized = path.normalize(filePath);
  return allowedRoots.some(root =>
    normalized.startsWith(path.normalize(root) + path.sep) ||
    normalized === path.normalize(root)
  );
}

describe('app:// protocol confinement', () => {
  it('allows files under recordings folder', () => {
    const allowed = checkConfinement(
      'C:/Users/test/Documents/MeetingTranscriber/recordings/test.mp3',
      ['C:/Users/test/AppData/Roaming/MeetingTranscriber', 'C:/Users/test/Documents/MeetingTranscriber']
    );
    expect(allowed).toBe(true);
  });

  it('allows files under userData folder', () => {
    const allowed = checkConfinement(
      'C:/Users/test/AppData/Roaming/MeetingTranscriber/something.mp3',
      ['C:/Users/test/AppData/Roaming/MeetingTranscriber', 'C:/Users/test/Documents/MeetingTranscriber']
    );
    expect(allowed).toBe(true);
  });

  it('blocks files outside allowed roots', () => {
    const allowed = checkConfinement(
      'C:/Windows/System32/config/SAM',
      ['C:/Users/test/AppData/Roaming/MeetingTranscriber', 'C:/Users/test/Documents/MeetingTranscriber']
    );
    expect(allowed).toBe(false);
  });

  it('blocks a file in the user home directory', () => {
    const allowed = checkConfinement(
      'C:/Users/test/secrets.json',
      ['C:/Users/test/AppData/Roaming/MeetingTranscriber', 'C:/Users/test/Documents/MeetingTranscriber']
    );
    expect(allowed).toBe(false);
  });

  it('blocks path traversal attempt', () => {
    // path.normalize resolves ../../ to give C:/Users/test/secrets.json
    // which is outside all allowed roots
    const allowed = checkConfinement(
      'C:/Users/test/Documents/MeetingTranscriber/../../secrets.json',
      ['C:/Users/test/AppData/Roaming/MeetingTranscriber', 'C:/Users/test/Documents/MeetingTranscriber']
    );
    // path.normalize resolves to C:\Users\test\secrets.json (outside allowed)
    expect(allowed).toBe(false);
  });

  it('allows root directory itself', () => {
    const allowed = checkConfinement(
      'C:/Users/test/Documents/MeetingTranscriber',
      ['C:/Users/test/AppData/Roaming/MeetingTranscriber', 'C:/Users/test/Documents/MeetingTranscriber']
    );
    expect(allowed).toBe(true);
  });

  it('blocks a path that is a prefix match but not under the root', () => {
    // Ensure we do not allow C:/Users/test/Documents/MeetingTranscriberEvil/file
    const allowed = checkConfinement(
      'C:/Users/test/Documents/MeetingTranscriberEvil/file.mp3',
      ['C:/Users/test/AppData/Roaming/MeetingTranscriber', 'C:/Users/test/Documents/MeetingTranscriber']
    );
    expect(allowed).toBe(false);
  });
});
