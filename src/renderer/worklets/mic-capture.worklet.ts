/**
 * mic-capture.worklet.ts — AudioWorkletProcessor for microphone capture.
 *
 * Runs in the audio worklet thread (separate from the renderer JS thread).
 * Cannot import from the main renderer bundle — must be self-contained.
 *
 * Architecture (IPC-batched PCM):
 * Instead of a SharedArrayBuffer ring buffer (which cannot be transferred
 * across Electron IPC), this processor accumulates ~50 ms of PCM samples
 * and posts them to the renderer thread via this.port.postMessage.
 * The renderer's useRecorder hook then forwards the batch to the main process
 * via ipcRenderer.invoke('recorder:pcm-chunk'). This adds one IPC call per
 * 50 ms (20/s) — acceptable vs. per-frame IPC (4410/s at 44100 Hz).
 *
 * PCM encoding: Float32 [-1, 1] → Int16 [-32767, 32767].
 * Batch size: FRAMES_PER_BATCH samples (≈50 ms at 44100 Hz = 2205 samples).
 * The AudioWorklet process() callback delivers 128 frames per call.
 */

// AudioWorkletProcessor and registerProcessor are globals in the audio worklet scope.
// TypeScript's DOM lib declares them; no imports needed.

const BATCH_FRAMES = Math.round(44100 * 0.05); // 2205 samples = ~50 ms at 44100 Hz

class MicCaptureProcessor extends AudioWorkletProcessor {
  private buffer: Int16Array;
  private bufferOffset = 0;
  /**
   * Loudest absolute sample in the batch being accumulated, 0..1. Tracked here rather
   * than in the renderer because this loop already visits every sample; the renderer
   * would have to walk the batch a second time on the thread that draws the UI.
   */
  private peak = 0;

  constructor(options: AudioWorkletNodeOptions) {
    super(options);
    // Pre-allocate a buffer large enough for one batch plus one extra process()
    // call (128 frames) to avoid reallocation mid-batch.
    this.buffer = new Int16Array(BATCH_FRAMES + 128);
  }

  process(inputs: Float32Array[][]): boolean {
    const input = inputs[0];
    if (!input || input.length === 0) return true;
    const channel = input[0];
    if (!channel || channel.length === 0) return true;

    // Convert Float32 → Int16 and append to accumulator.
    for (let i = 0; i < channel.length; i++) {
      const s = channel[i];
      // Clamp to [-1, 1] before scaling to avoid overflow.
      const clamped = s > 1 ? 1 : s < -1 ? -1 : s;
      const magnitude = clamped < 0 ? -clamped : clamped;
      if (magnitude > this.peak) this.peak = magnitude;
      this.buffer[this.bufferOffset++] = Math.round(clamped * 32767);
    }

    // When we have accumulated BATCH_FRAMES samples, send the batch.
    if (this.bufferOffset >= BATCH_FRAMES) {
      // Slice exactly BATCH_FRAMES samples — any overflow stays in buffer.
      const batch = this.buffer.slice(0, BATCH_FRAMES);
      this.port.postMessage({ type: 'pcm', data: batch, peak: this.peak });
      this.peak = 0;

      // Shift the overflow to the front of the buffer.
      const overflow = this.bufferOffset - BATCH_FRAMES;
      if (overflow > 0) {
        this.buffer.copyWithin(0, BATCH_FRAMES, this.bufferOffset);
      }
      this.bufferOffset = overflow;
    }

    return true; // keep processor alive
  }
}

registerProcessor('mic-capture', MicCaptureProcessor);
