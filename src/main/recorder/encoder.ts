/**
 * encoder.ts — lamejs MP3 encoding Worker thread.
 *
 * Runs as a Node.js worker_threads Worker. Receives PCM Int16 chunks from
 * the recorder orchestrator via parentPort messages, encodes them to MP3
 * at 128 kbps using lamejs (pure JS), and streams the output to disk.
 *
 * lamejs loading note:
 *   lamejs's `main` entry (src/js/index.js) uses browser-style global scope
 *   sharing between its CJS modules (e.g. Lame.js references MPEGMode without
 *   requiring it). This breaks under modern Node.js module isolation.
 *   We load lame.all.js — the self-contained single-file bundle — via
 *   new Function() so it executes in a scope where `lamejs` is its own object,
 *   avoiding any global-scope pollution.
 *
 * Message protocol (parent → worker):
 *   { type: 'start',  data: { outputPath: string; sampleRate: number } }
 *   { type: 'pcm',    data: Int16Array }  — encoded and written to disk
 *   { type: 'pause' }                      — subsequent PCM chunks are dropped
 *   { type: 'resume' }                     — resume encoding
 *   { type: 'flush' }                      — finalize MP3 and close stream
 *
 * Message protocol (worker → parent):
 *   { type: 'flushed' }   — flush complete; file is ready
 *   { type: 'error', error: string }
 */

import { parentPort } from 'worker_threads';
import { createRequire } from 'module';
import * as path from 'path';
import * as fs from 'fs';

// Resolve require from this file's location so paths work in both dev and prod.
const _require = createRequire(import.meta.url);

// Load lame.all.js — the self-contained lamejs bundle.
// src/js/index.js (lamejs's `main`) has global-scope issues under Node.js;
// lame.all.js is the single-file build that works correctly.
function loadLamejs(): { Mp3Encoder: new (channels: number, sampleRate: number, bitRate: number) => {
  encodeBuffer: (left: Int16Array, right?: Int16Array) => Int8Array;
  flush: () => Int8Array;
}; } {
  const lameAllPath = _require.resolve('lamejs/lame.all.js');
  const code = fs.readFileSync(lameAllPath, 'utf8');
  // lame.all.js wraps everything in `function lamejs() { ... }` and calls
  // `lamejs()` at the end, exporting via the `lamejs` identifier.
  // We pass lamejs as a parameter so the function assigns to our object.
  const lamejs: Record<string, unknown> = {};
  // eslint-disable-next-line no-new-func
  const fn = new Function('lamejs', code + '; return lamejs;');
  return fn(lamejs) as ReturnType<typeof loadLamejs>;
}

const BIT_RATE = 128;  // kbps
const CHANNELS = 1;    // mono

let encoderLib: ReturnType<typeof loadLamejs> | null = null;
let encoder: ReturnType<ReturnType<typeof loadLamejs>['Mp3Encoder']['prototype']['constructor']> | null = null;
let outputStream: fs.WriteStream | null = null;
let paused = false;

function getLib(): ReturnType<typeof loadLamejs> {
  if (!encoderLib) {
    encoderLib = loadLamejs();
  }
  return encoderLib;
}

function flush(): void {
  if (!encoder) return;
  const finalBuffer = encoder.flush();
  if (finalBuffer && finalBuffer.length > 0 && outputStream) {
    outputStream.write(Buffer.from(finalBuffer));
  }
}

if (!parentPort) {
  throw new Error('encoder.ts must be run as a Worker thread');
}

parentPort.on('message', (msg: { type: string; data?: unknown }) => {
  switch (msg.type) {
    case 'start': {
      const { outputPath, sampleRate } = msg.data as { outputPath: string; sampleRate: number };
      const lib = getLib();
      // Resolve the encoder path relative to the worker's working directory
      // if it's not absolute, to handle relative paths from the renderer.
      const resolvedPath = path.isAbsolute(outputPath)
        ? outputPath
        : path.resolve(process.cwd(), outputPath);

      // Ensure the output directory exists.
      fs.mkdirSync(path.dirname(resolvedPath), { recursive: true });

      encoder = new lib.Mp3Encoder(CHANNELS, sampleRate, BIT_RATE);
      paused = false;
      // Use 'w' — each recording session creates a fresh file.
      outputStream = fs.createWriteStream(resolvedPath, { flags: 'w' });
      outputStream.on('error', (err) => {
        parentPort!.postMessage({ type: 'error', error: err.message });
      });
      break;
    }

    case 'pcm': {
      if (!encoder || !outputStream || paused) break;
      const pcmData = msg.data as Int16Array;
      const encoded = encoder.encodeBuffer(pcmData);
      if (encoded.length > 0) {
        outputStream.write(Buffer.from(encoded));
      }
      break;
    }

    case 'pause':
      paused = true;
      break;

    case 'resume':
      paused = false;
      break;

    case 'flush': {
      flush();
      if (outputStream) {
        outputStream.end(() => {
          parentPort!.postMessage({ type: 'flushed' });
        });
      } else {
        // No stream was ever opened (flush called without start, or already closed).
        parentPort!.postMessage({ type: 'flushed' });
      }
      encoder = null;
      outputStream = null;
      break;
    }

    default:
      // Unknown message type — ignore.
      break;
  }
});
