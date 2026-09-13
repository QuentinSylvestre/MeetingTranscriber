import { describe, it, expect, vi } from 'vitest';

// Mock electron and dependencies — still needed so the module can be imported
// without a live Electron runtime.
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

import { isPathAllowed } from '../../src/main/ipc/protocol';

const ROOTS = [
  'C:/Users/test/AppData/Roaming/MeetingTranscriber',
  'C:/Users/test/Documents/MeetingTranscriber',
];

describe('app:// protocol confinement', () => {
  it('allows files under recordings folder', () => {
    expect(isPathAllowed(
      'C:/Users/test/Documents/MeetingTranscriber/recordings/test.mp3',
      ROOTS
    )).toBe(true);
  });

  it('allows files under userData folder', () => {
    expect(isPathAllowed(
      'C:/Users/test/AppData/Roaming/MeetingTranscriber/something.mp3',
      ROOTS
    )).toBe(true);
  });

  it('blocks files outside allowed roots', () => {
    expect(isPathAllowed('C:/Windows/System32/config/SAM', ROOTS)).toBe(false);
  });

  it('blocks a file in the user home directory', () => {
    expect(isPathAllowed('C:/Users/test/secrets.json', ROOTS)).toBe(false);
  });

  it('blocks path traversal attempt', () => {
    // path.normalize resolves ../../ to give C:\Users\test\secrets.json
    expect(isPathAllowed(
      'C:/Users/test/Documents/MeetingTranscriber/../../secrets.json',
      ROOTS
    )).toBe(false);
  });

  it('allows root directory itself', () => {
    expect(isPathAllowed(
      'C:/Users/test/Documents/MeetingTranscriber',
      ROOTS
    )).toBe(true);
  });

  it('blocks a path that is a prefix match but not under the root', () => {
    expect(isPathAllowed(
      'C:/Users/test/Documents/MeetingTranscriberEvil/file.mp3',
      ROOTS
    )).toBe(false);
  });

  it('blocks UNC paths (// prefix)', () => {
    expect(isPathAllowed('//server/share/file.mp3', ROOTS)).toBe(false);
  });

  it('blocks UNC paths (\\\\ prefix)', () => {
    expect(isPathAllowed('\\\\server\\share\\file.mp3', ROOTS)).toBe(false);
  });
});
