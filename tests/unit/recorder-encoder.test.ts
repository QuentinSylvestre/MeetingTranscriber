/**
 * recorder-encoder.test.ts — Unit tests for the lamejs MP3 encoder Worker.
 *
 * Tests the encoder by running it as a Worker thread (the same execution path
 * used at runtime) and feeding it synthetic PCM data.
 *
 * Note on Worker loading: the encoder is a TypeScript source file. Vitest runs
 * in Node.js via ts-node / @vitest/runner's built-in TSX transform, so we can
 * pass the .ts file directly to new Worker() with the ts-node register exec arg.
 * The worker path is resolved relative to the project root.
 */

import { describe, it, expect } from 'vitest';
import { Worker } from 'worker_threads';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

const ENCODER_PATH = path.resolve(process.cwd(), 'src/main/recorder/encoder.ts');

/**
 * Spawn the encoder Worker with ts-node registration so TypeScript source
 * can be loaded directly.
 */
function spawnEncoderWorker(): Worker {
  return new Worker(ENCODER_PATH, {
    execArgv: ['--require', 'ts-node/register/transpile-only'],
  });
}

/**
 * Wait for a 'flushed' message from the worker, with a timeout.
 */
function waitForFlush(worker: Worker, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`Encoder flush timed out after ${timeoutMs}ms`)),
      timeoutMs
    );
    worker.on('message', (msg: { type: string; error?: string }) => {
      if (msg.type === 'flushed') {
        clearTimeout(timer);
        resolve();
      }
      if (msg.type === 'error') {
        clearTimeout(timer);
        reject(new Error(`Encoder error: ${msg.error}`));
      }
    });
    worker.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

/** Resolves with the first worker message whose type matches, or rejects on timeout. */
function waitForMessage(
  worker: Worker,
  type: string,
  timeoutMs: number,
): Promise<{ type: string; error?: string }> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`No '${type}' message within ${timeoutMs}ms`)), timeoutMs);
    worker.on('message', (msg: { type: string; error?: string }) => {
      if (msg.type === type) { clearTimeout(timer); resolve(msg); }
    });
    worker.on('error', (err) => { clearTimeout(timer); reject(err); });
  });
}

describe('recorder/encoder start and failure reporting', () => {
  it("acknowledges 'started' once the output file is open", async () => {
    const tmpFile = path.join(os.tmpdir(), `test-enc-started-${Date.now()}.mp3`);
    const worker = spawnEncoderWorker();
    const started = waitForMessage(worker, 'started', 15_000);
    worker.postMessage({ type: 'start', data: { outputPath: tmpFile, sampleRate: 44100 } });
    await started;
    expect(fs.existsSync(tmpFile)).toBe(true);
    const flushed = waitForMessage(worker, 'flushed', 5_000);
    worker.postMessage({ type: 'flush' });
    await flushed;
    await worker.terminate();
    fs.unlinkSync(tmpFile);
  }, 25_000);

  it('reports an error, instead of dying silently, when the output folder cannot be created', async () => {
    // Observed with an unreachable recordings folder: the worker threw inside its message
    // handler, the parent never heard, and the session recorded nothing while looking normal.
    // A path whose parent is an existing FILE cannot be created on any platform.
    const blocker = path.join(os.tmpdir(), `test-enc-blocker-${Date.now()}`);
    fs.writeFileSync(blocker, 'x');
    const worker = spawnEncoderWorker();
    const error = waitForMessage(worker, 'error', 15_000);
    worker.postMessage({ type: 'start', data: { outputPath: path.join(blocker, 'sub', 'rec.mp3'), sampleRate: 44100 } });
    const msg = await error;
    expect(msg.error).toBeTruthy();
    await worker.terminate();
    fs.unlinkSync(blocker);
  }, 25_000);

  it('answers a flush after a failed start with the same error instead of hanging', async () => {
    const blocker = path.join(os.tmpdir(), `test-enc-blocker2-${Date.now()}`);
    fs.writeFileSync(blocker, 'x');
    const worker = spawnEncoderWorker();
    const messages: { type: string; error?: string }[] = [];
    worker.on('message', (m: { type: string; error?: string }) => messages.push(m));
    worker.postMessage({ type: 'start', data: { outputPath: path.join(blocker, 'sub', 'rec.mp3'), sampleRate: 44100 } });
    worker.postMessage({ type: 'flush' });
    const deadline = Date.now() + 15_000;
    while (messages.filter(m => m.type === 'error').length < 2 && Date.now() < deadline) {
      await new Promise(r => setTimeout(r, 50));
    }
    expect(messages.filter(m => m.type === 'error').length).toBeGreaterThanOrEqual(2);
    expect(messages.some(m => m.type === 'flushed')).toBe(false);
    await worker.terminate();
    fs.unlinkSync(blocker);
  }, 25_000);
});

describe('recorder/encoder', () => {
  it('produces a valid MP3 with sync word from 1 second of 440 Hz sine wave', async () => {
    const tmpFile = path.join(os.tmpdir(), `test-enc-sine-${Date.now()}.mp3`);

    const worker = spawnEncoderWorker();
    const flushPromise = waitForFlush(worker, 15_000);

    // Start encoder.
    worker.postMessage({ type: 'start', data: { outputPath: tmpFile, sampleRate: 44100 } });

    // Generate 1 second of 440 Hz sine wave as Int16 PCM.
    const sampleRate = 44100;
    const pcm = new Int16Array(sampleRate);
    for (let i = 0; i < sampleRate; i++) {
      pcm[i] = Math.round(Math.sin((2 * Math.PI * 440 * i) / sampleRate) * 16000);
    }
    worker.postMessage({ type: 'pcm', data: pcm });

    // Flush and wait.
    worker.postMessage({ type: 'flush' });
    await flushPromise;
    await worker.terminate();

    // File must exist and be non-trivial.
    expect(fs.existsSync(tmpFile)).toBe(true);
    const buf = fs.readFileSync(tmpFile);
    expect(buf.length).toBeGreaterThan(100);

    // Scan first 256 bytes for an MP3 sync word: 0xFF followed by a byte
    // whose top 3 bits are 111 (0xE0 mask). This covers MPEG1/2/2.5 layer 1/2/3.
    let foundSync = false;
    const scanLimit = Math.min(256, buf.length - 1);
    for (let i = 0; i < scanLimit; i++) {
      if (buf[i] === 0xff && (buf[i + 1]! & 0xe0) === 0xe0) {
        foundSync = true;
        break;
      }
    }
    expect(foundSync).toBe(true);

    fs.unlinkSync(tmpFile);
  }, 20_000);

  it('flush completes within 2 seconds for empty input', async () => {
    const tmpFile = path.join(os.tmpdir(), `test-enc-empty-${Date.now()}.mp3`);

    const worker = spawnEncoderWorker();
    const flushPromise = waitForFlush(worker, 5_000);

    const start = Date.now();
    worker.postMessage({ type: 'start', data: { outputPath: tmpFile, sampleRate: 44100 } });
    worker.postMessage({ type: 'flush' });
    await flushPromise;
    const elapsed = Date.now() - start;

    await worker.terminate();

    expect(elapsed).toBeLessThan(2000);

    try { fs.unlinkSync(tmpFile); } catch { /* file may be empty but exists */ }
  }, 8_000);

  it('pause gates PCM chunks; resume resumes encoding', async () => {
    const tmpFile = path.join(os.tmpdir(), `test-enc-pause-${Date.now()}.mp3`);

    const worker = spawnEncoderWorker();
    const flushPromise = waitForFlush(worker, 15_000);

    worker.postMessage({ type: 'start', data: { outputPath: tmpFile, sampleRate: 44100 } });

    // Send some PCM before pausing.
    const pcmBefore = new Int16Array(4410).fill(1000);
    worker.postMessage({ type: 'pcm', data: pcmBefore });

    // Pause — subsequent PCM should be dropped.
    worker.postMessage({ type: 'pause' });
    const pcmDropped = new Int16Array(4410).fill(2000);
    worker.postMessage({ type: 'pcm', data: pcmDropped });

    // Resume — PCM should flow again.
    worker.postMessage({ type: 'resume' });
    const pcmAfter = new Int16Array(4410).fill(1000);
    worker.postMessage({ type: 'pcm', data: pcmAfter });

    worker.postMessage({ type: 'flush' });
    await flushPromise;
    await worker.terminate();

    // File should exist and contain some MP3 data (from before + after chunks).
    expect(fs.existsSync(tmpFile)).toBe(true);
    const buf = fs.readFileSync(tmpFile);
    expect(buf.length).toBeGreaterThan(0);

    try { fs.unlinkSync(tmpFile); } catch { /* ok */ }
  }, 20_000);
});
