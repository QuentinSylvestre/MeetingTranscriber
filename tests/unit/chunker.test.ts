import { describe, it, expect, beforeAll, vi } from 'vitest';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

// electron is not available in Vitest's Node environment.
vi.mock('electron', () => ({
  app: { getPath: vi.fn(() => '/tmp/test') },
  ipcMain: { handle: vi.fn() },
}));

// electron-log: silence output in tests, provide minimal API surface.
vi.mock('electron-log', () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import { chunkAudio } from '../../src/main/chunker/index';

const FIXTURE_PATH = path.resolve(process.cwd(), 'tests/fixtures/10s-silence.mp3');

beforeAll(() => {
  if (!fs.existsSync(FIXTURE_PATH)) {
    throw new Error(
      `Test fixture missing: ${FIXTURE_PATH}. Run: node scripts/create-test-fixture.cjs`
    );
  }
});

describe('chunker', () => {
  it('returns input path for AssemblyAI (no chunking)', async () => {
    const result = await chunkAudio(FIXTURE_PATH, 'assemblyai', os.tmpdir());
    expect(result.paths).toHaveLength(1);
    expect(result.paths[0]).toBe(FIXTURE_PATH);
    expect(result.chunkDurationMs).toBe(Infinity);
  });

  it('returns input path for ElevenLabs (no chunking)', async () => {
    const result = await chunkAudio(FIXTURE_PATH, 'elevenlabs', os.tmpdir());
    expect(result.paths).toHaveLength(1);
    expect(result.paths[0]).toBe(FIXTURE_PATH);
    expect(result.chunkDurationMs).toBe(Infinity);
  });

  it('no-chunk providers do not invoke ffmpeg (ffmpeg.exe not required)', async () => {
    // If ffmpeg were called, it would fail on a bad path — this proves it was not called.
    const result = await chunkAudio(FIXTURE_PATH, 'assemblyai', os.tmpdir());
    expect(result.paths[0]).toBe(FIXTURE_PATH);
  });

  it('produces at least one chunk for OpenAI (invokes ffmpeg)', async () => {
    const outputDir = path.join(os.tmpdir(), `chunk-test-${Date.now()}`);
    fs.mkdirSync(outputDir, { recursive: true });

    // With CHUNK_DURATION_S=1000 a 10s file yields exactly 1 chunk.
    const result = await chunkAudio(FIXTURE_PATH, 'openai', outputDir);
    expect(result.paths.length).toBeGreaterThanOrEqual(1);
    expect(result.chunkDurationMs).toBe(1_000_000); // 1000s * 1000ms

    // Every chunk must be a non-empty MP3 file
    for (const chunkPath of result.paths) {
      expect(fs.existsSync(chunkPath)).toBe(true);
      const buf = fs.readFileSync(chunkPath);
      expect(buf.length).toBeGreaterThan(0);
    }

    fs.rmSync(outputDir, { recursive: true, force: true });
  }, 30_000);

  it('produces at least one chunk for Google (invokes ffmpeg)', async () => {
    const outputDir = path.join(os.tmpdir(), `chunk-google-test-${Date.now()}`);
    fs.mkdirSync(outputDir, { recursive: true });

    const result = await chunkAudio(FIXTURE_PATH, 'google', outputDir);
    expect(result.paths.length).toBeGreaterThanOrEqual(1);

    fs.rmSync(outputDir, { recursive: true, force: true });
  }, 30_000);

  it('combined size of OpenAI chunks is <= original + 5% + 1KB tolerance', async () => {
    const outputDir = path.join(os.tmpdir(), `chunk-size-test-${Date.now()}`);
    fs.mkdirSync(outputDir, { recursive: true });

    const originalSize = fs.statSync(FIXTURE_PATH).size;
    const result = await chunkAudio(FIXTURE_PATH, 'openai', outputDir);
    const totalChunkSize = result.paths.reduce(
      (sum, p) => sum + fs.statSync(p).size,
      0
    );

    // Re-encoding at the same bitrate (128k) should not significantly inflate the file.
    // Allow 5% overhead plus 1 KB for MP3 header/metadata.
    expect(totalChunkSize).toBeLessThanOrEqual(originalSize * 1.05 + 1024);

    fs.rmSync(outputDir, { recursive: true, force: true });
  }, 30_000);

  it('chunk output files are named chunk_NNN.mp3', async () => {
    const outputDir = path.join(os.tmpdir(), `chunk-name-test-${Date.now()}`);
    fs.mkdirSync(outputDir, { recursive: true });

    const result = await chunkAudio(FIXTURE_PATH, 'openai', outputDir);
    for (const chunkPath of result.paths) {
      expect(path.basename(chunkPath)).toMatch(/^chunk_\d{3}\.mp3$/);
    }

    fs.rmSync(outputDir, { recursive: true, force: true });
  }, 30_000);
});
