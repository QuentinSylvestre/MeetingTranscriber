import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn((key: string) =>
      key === 'userData' ? 'C:/Users/test/AppData/Roaming/MeetingTranscriber' : ''
    ),
  },
  protocol: { registerSchemesAsPrivileged: vi.fn(), handle: vi.fn() },
}));
vi.mock('../../src/main/settings/store', () => ({
  getPreference: vi.fn(() => 'C:/Users/test/Documents/MeetingTranscriber'),
}));
vi.mock('electron-log', () => ({
  default: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
}));

import { isPathAllowed, handleAppRequest } from '../../src/main/ipc/protocol';

// ---------------------------------------------------------------------------
// Real temp file used across all handler tests
// ---------------------------------------------------------------------------
// 100 bytes: 0x00, 0x01, 0x02, ..., 0x63
const CONTENT = Buffer.from(Array.from({ length: 100 }, (_, i) => i));
let tmpFile: string;
let tmpDir: string;
const ALLOWED: string[] = [];

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'protocol-test-'));
  tmpFile = path.join(tmpDir, 'test.mp3');
  fs.writeFileSync(tmpFile, CONTENT);
  ALLOWED.push(tmpDir);
});

afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// isPathAllowed — confinement logic
// ---------------------------------------------------------------------------
const ROOTS = [
  'C:/Users/test/AppData/Roaming/MeetingTranscriber',
  'C:/Users/test/Documents/MeetingTranscriber',
];

describe('isPathAllowed', () => {
  it('allows files under recordings folder', () => {
    expect(isPathAllowed('C:/Users/test/Documents/MeetingTranscriber/test.mp3', ROOTS)).toBe(true);
  });
  it('allows files under userData folder', () => {
    expect(isPathAllowed('C:/Users/test/AppData/Roaming/MeetingTranscriber/x.mp3', ROOTS)).toBe(true);
  });
  it('allows root directory itself', () => {
    expect(isPathAllowed('C:/Users/test/Documents/MeetingTranscriber', ROOTS)).toBe(true);
  });
  it('blocks files outside allowed roots', () => {
    expect(isPathAllowed('C:/Windows/System32/config/SAM', ROOTS)).toBe(false);
  });
  it('blocks a file in the user home directory', () => {
    expect(isPathAllowed('C:/Users/test/secrets.json', ROOTS)).toBe(false);
  });
  it('blocks path traversal attempt', () => {
    expect(isPathAllowed('C:/Users/test/Documents/MeetingTranscriber/../../secrets.json', ROOTS)).toBe(false);
  });
  it('blocks prefix-match-but-not-under-root path', () => {
    expect(isPathAllowed('C:/Users/test/Documents/MeetingTranscriberEvil/file.mp3', ROOTS)).toBe(false);
  });
  it('blocks UNC paths (// prefix)', () => {
    expect(isPathAllowed('//server/share/file.mp3', ROOTS)).toBe(false);
  });
  it('blocks UNC paths (\\\\ prefix)', () => {
    expect(isPathAllowed('\\\\server\\share\\file.mp3', ROOTS)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// handleAppRequest — full handler logic against a real file
// ---------------------------------------------------------------------------

function makeUrl(filePath: string): string {
  // Replicate what TranscriptView does: app://<drive>/<rest> on Windows,
  // which is also what Chromium normalises app:///C:/... to (standard scheme).
  const forward = filePath.replace(/\\/g, '/');
  const winDrive = forward.match(/^([A-Za-z]):\/(.*)/);
  if (winDrive) return `app://${winDrive[1].toLowerCase()}/${winDrive[2]}`;
  return `app://${forward}`;
}

describe('handleAppRequest — full file (no Range)', () => {
  it('returns 200 with full content and Accept-Ranges header', async () => {
    const resp = handleAppRequest(makeUrl(tmpFile), null, ALLOWED);
    expect(resp.status).toBe(200);
    expect(resp.headers.get('Content-Type')).toBe('audio/mpeg');
    expect(resp.headers.get('Accept-Ranges')).toBe('bytes');
    expect(resp.headers.get('Content-Length')).toBe('100');
    const body = Buffer.from(await resp.arrayBuffer());
    expect(body).toEqual(CONTENT);
  });
});

describe('handleAppRequest — range requests (HTTP 206)', () => {
  it('returns 206 with correct bytes for bytes=0-9', async () => {
    const resp = handleAppRequest(makeUrl(tmpFile), 'bytes=0-9', ALLOWED);
    expect(resp.status).toBe(206);
    expect(resp.headers.get('Content-Range')).toBe('bytes 0-9/100');
    expect(resp.headers.get('Content-Length')).toBe('10');
    expect(resp.headers.get('Accept-Ranges')).toBe('bytes');
    const body = Buffer.from(await resp.arrayBuffer());
    expect(body).toEqual(CONTENT.slice(0, 10));
  });

  it('returns 206 for a mid-file range bytes=50-59', async () => {
    const resp = handleAppRequest(makeUrl(tmpFile), 'bytes=50-59', ALLOWED);
    expect(resp.status).toBe(206);
    expect(resp.headers.get('Content-Range')).toBe('bytes 50-59/100');
    const body = Buffer.from(await resp.arrayBuffer());
    expect(body).toEqual(CONTENT.slice(50, 60));
  });

  it('clamps end to file size for bytes=90-999', async () => {
    const resp = handleAppRequest(makeUrl(tmpFile), 'bytes=90-999', ALLOWED);
    expect(resp.status).toBe(206);
    expect(resp.headers.get('Content-Range')).toBe('bytes 90-99/100');
    expect(resp.headers.get('Content-Length')).toBe('10');
    const body = Buffer.from(await resp.arrayBuffer());
    expect(body).toEqual(CONTENT.slice(90, 100));
  });

  it('handles suffix range bytes=-10 (last 10 bytes)', async () => {
    const resp = handleAppRequest(makeUrl(tmpFile), 'bytes=-10', ALLOWED);
    expect(resp.status).toBe(206);
    expect(resp.headers.get('Content-Range')).toBe('bytes 90-99/100');
    const body = Buffer.from(await resp.arrayBuffer());
    expect(body).toEqual(CONTENT.slice(90, 100));
  });

  it('handles open-ended range bytes=95- (to end of file)', async () => {
    const resp = handleAppRequest(makeUrl(tmpFile), 'bytes=95-', ALLOWED);
    expect(resp.status).toBe(206);
    expect(resp.headers.get('Content-Range')).toBe('bytes 95-99/100');
    expect(resp.headers.get('Content-Length')).toBe('5');
    const body = Buffer.from(await resp.arrayBuffer());
    expect(body).toEqual(CONTENT.slice(95, 100));
  });

  it('returns 416 for out-of-range start bytes=200-299', () => {
    const resp = handleAppRequest(makeUrl(tmpFile), 'bytes=200-299', ALLOWED);
    expect(resp.status).toBe(416);
    expect(resp.headers.get('Content-Range')).toBe('bytes */100');
  });

  it('returns 416 for malformed Range header', () => {
    const resp = handleAppRequest(makeUrl(tmpFile), 'words=0-9', ALLOWED);
    expect(resp.status).toBe(416);
  });
});

describe('handleAppRequest — security and error cases', () => {
  it('returns 403 for a file outside allowed roots', () => {
    const outsidePath = path.join(os.tmpdir(), 'secret.mp3');
    // Use a dir not in ALLOWED (tmpDir is allowed, os.tmpdir() root is not)
    const resp = handleAppRequest(makeUrl(outsidePath), null, ALLOWED);
    expect(resp.status).toBe(403);
  });

  it('returns 404 for a non-existent file inside allowed root', () => {
    const missing = path.join(tmpDir, 'missing.mp3');
    const resp = handleAppRequest(makeUrl(missing), null, ALLOWED);
    expect(resp.status).toBe(404);
  });

  it('returns audio/mp4 MIME for .m4a files', async () => {
    const m4aFile = path.join(tmpDir, 'test.m4a');
    fs.writeFileSync(m4aFile, CONTENT);
    const resp = handleAppRequest(makeUrl(m4aFile), null, ALLOWED);
    expect(resp.headers.get('Content-Type')).toBe('audio/mp4');
  });
});
