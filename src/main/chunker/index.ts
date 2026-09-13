import * as path from 'path';
import * as fs from 'fs';
import { spawn } from 'child_process';
import log from 'electron-log';
import type { ProviderName, ChunkResult } from '../../shared/ipc-types';

// ffmpeg-static resolves to the ffmpeg.exe path.
// In production (installed app), it is in process.resourcesPath.
// In dev/test, it's in node_modules/ffmpeg-static.
function getFfmpegPath(): string {
  // F3: Check process.resourcesPath directly — it is only defined inside a running Electron app.
  // The old check (NODE_ENV !== 'development' && !== 'test') incorrectly routed test runs to
  // the production path, causing test failures when resourcesPath is undefined.
  if (
    typeof (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath === 'string' &&
    (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath!.length > 0
  ) {
    const prodPath = path.join(
      (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath!,
      'ffmpeg.exe'
    );
    if (fs.existsSync(prodPath)) return prodPath;
  }
  // Dev/test fallback: use the node_modules package
  try {
    // require() needed because ffmpeg-static ships as CommonJS with a default export.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const ffmpegStatic = require('ffmpeg-static') as string | { default: string };
    return typeof ffmpegStatic === 'string' ? ffmpegStatic : ffmpegStatic.default;
  } catch {
    throw new Error(
      'ffmpeg-static not found. Install ffmpeg-static or ensure ffmpeg.exe is in resourcesPath.'
    );
  }
}

/**
 * Providers that do not need chunking.
 * These providers handle long files natively.
 */
const NO_CHUNK_PROVIDERS: ProviderName[] = ['assemblyai', 'elevenlabs'];

const CHUNK_DURATION_S = 1000; // 1000-second chunks (safe margin under OpenAI 1500s limit)
const CHUNK_DURATION_MS = CHUNK_DURATION_S * 1000;

/**
 * Split audio file into chunks for providers that require it.
 * AssemblyAI and ElevenLabs: returns [inputPath] with no ffmpeg call.
 * OpenAI and Google: re-encodes to exact-boundary chunks at 128 kbps MP3.
 *
 * @param inputPath Absolute path to the source MP3 file
 * @param provider The transcription provider
 * @param outputDir Directory for chunk files (must exist or be creatable)
 * @returns Array of chunk file paths and the chunk duration in ms
 */
export async function chunkAudio(
  inputPath: string,
  provider: ProviderName,
  outputDir: string
): Promise<ChunkResult> {
  // No chunking needed for AssemblyAI and ElevenLabs
  if (NO_CHUNK_PROVIDERS.includes(provider)) {
    return { paths: [inputPath], chunkDurationMs: Infinity };
  }

  // Disk space check: a 4-hour file re-encoded to multiple chunks requires scratch space.
  // Warn if available space < fileSize * 1.5
  const fileStat = fs.statSync(inputPath);
  const fileSize = fileStat.size;
  try {
    // fs.statfsSync is available in Node 19+; cast to avoid TS error on older typings.
    type FsExt = typeof fs & { statfsSync?: (p: string) => { bavail: number; bsize: number } };
    const spaceStats = (fs as FsExt).statfsSync?.(outputDir);
    if (spaceStats) {
      const availableBytes = spaceStats.bavail * spaceStats.bsize;
      if (availableBytes < fileSize * 1.5) {
        log.warn(
          `Low disk space for chunking: ${Math.round(availableBytes / 1024 / 1024)} MB available, ` +
          `need ~${Math.round((fileSize * 1.5) / 1024 / 1024)} MB`
        );
        // The IPC handler surfaces this warning to the renderer.
      }
    }
  } catch { /* statfs not available in this Node version */ }

  fs.mkdirSync(outputDir, { recursive: true });

  // F5: Pre-clean — remove stale chunk files from any prior run to prevent
  // a failed re-run from returning a mix of old and new chunks.
  const staleChunks = fs.readdirSync(outputDir).filter(f => /^chunk_\d+\.mp3$/.test(f));
  for (const f of staleChunks) {
    fs.unlinkSync(path.join(outputDir, f));
  }

  const outputPattern = path.join(outputDir, 'chunk_%03d.mp3');
  const ffmpegPath = getFfmpegPath();

  // Re-encode with exact boundaries (not stream-copy, which is keyframe-aligned).
  // -reset_timestamps 1: reset timestamps at each segment boundary.
  // -acodec libmp3lame: re-encode to MP3 (guarantees exact split boundaries).
  // shell: false always — args passed as array to prevent injection.
  const args = [
    '-i', inputPath,
    '-f', 'segment',
    '-segment_time', String(CHUNK_DURATION_S),
    '-reset_timestamps', '1',
    '-acodec', 'libmp3lame',
    '-ab', '128k',
    '-y', // overwrite
    outputPattern,
  ];

  log.info(`Chunking audio: ${inputPath} -> ${outputPattern} (${CHUNK_DURATION_S}s chunks)`);

  await runFfmpeg(ffmpegPath, args);

  // Collect output files in sorted order
  const files = fs
    .readdirSync(outputDir)
    .filter(f => f.startsWith('chunk_') && f.endsWith('.mp3'))
    .sort()
    .map(f => path.join(outputDir, f));

  if (files.length === 0) {
    throw new Error('ffmpeg produced no output chunks. Check input file format.');
  }

  log.info(`Chunking complete: ${files.length} chunks in ${outputDir}`);
  return { paths: files, chunkDurationMs: CHUNK_DURATION_MS };
}

// F4: Added timeout (default 30 min) to prevent runFfmpeg from hanging indefinitely.
// F6: Collect full stderr up to 2000 chars instead of just the last 20 lines.
function runFfmpeg(ffmpegPath: string, args: string[], timeoutMs = 30 * 60 * 1000): Promise<void> {
  return new Promise((resolve, reject) => {
    // shell: false — args passed as array, no shell injection possible
    const proc = spawn(ffmpegPath, args, { shell: false });
    const stderr: string[] = [];

    const timeout = setTimeout(() => {
      proc.kill();
      reject(new Error('ffmpeg timed out after 30 minutes'));
    }, timeoutMs);

    proc.stderr.on('data', (data: Buffer) => {
      stderr.push(data.toString());
    });

    proc.on('close', (code) => {
      clearTimeout(timeout);
      if (code === 0) {
        resolve();
      } else {
        // F6: full stderr truncated to last 2000 chars
        const errMsg = stderr.join('').slice(-2000);
        reject(new Error(`ffmpeg exited with code ${code}: ${errMsg}`));
      }
    });

    proc.on('error', (err) => {
      clearTimeout(timeout);
      reject(new Error(`Failed to spawn ffmpeg: ${err.message}`));
    });
  });
}
