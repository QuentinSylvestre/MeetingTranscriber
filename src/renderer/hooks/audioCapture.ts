/**
 * audioCapture.ts — the real microphone + AudioWorklet graph behind the recorder session.
 *
 * Kept apart from recorderSession.ts so that file has no browser dependency and its logic
 * can be tested in Node. Returns a handle whose close() releases everything this opened.
 */

import { RecorderStartError, classifyMicError } from './recorderSession';
import type { CaptureGraph } from './recorderSession';
// `?worker&url` makes Vite compile the worklet to a standalone JS bundle and hand back
// its URL. The obvious `new URL('../worklets/mic-capture.worklet.ts', import.meta.url)`
// is wrong here: Vite classifies that as a static asset, so a production build copies
// the TypeScript source verbatim — under the 4 KB inline limit it became a
// `data:video/mp2t;base64,` URI holding raw TS — and addModule() got something no JS
// engine can parse. The dev server transpiles on request, so this only ever broke the
// packaged app.
import micCaptureWorkletUrl from '../worklets/mic-capture.worklet.ts?worker&url';

export async function openCapture(
  micDeviceId: string | undefined,
  onBatch: (pcm: Int16Array, peak: number) => void,
  onInputEnded: () => void,
): Promise<CaptureGraph> {
  const ctx = new AudioContext({ sampleRate: 44100 });
  let stream: MediaStream | null = null;
  let node: AudioWorkletNode | null = null;

  const close = (): void => {
    if (node) {
      node.port.onmessage = null;
      node.disconnect();
      node = null;
    }
    stream?.getTracks().forEach((t) => t.stop());
    stream = null;
    ctx.close().catch(() => {});
  };

  try {
    // Load the AudioWorklet module. Vite emits it as its own compiled bundle; see the
    // note on the micCaptureWorkletUrl import for why it is not referenced by path.
    // Attributed separately from the microphone below: a failure here is a packaging
    // fault in the application, not something the user can act on.
    try {
      await ctx.audioWorklet.addModule(micCaptureWorkletUrl);
    } catch (err) {
      throw new RecorderStartError('audio_engine', err);
    }

    const constraints: MediaStreamConstraints = {
      audio: micDeviceId
        ? { deviceId: { exact: micDeviceId }, sampleRate: 44100, channelCount: 1 }
        : { sampleRate: 44100, channelCount: 1 },
    };
    try {
      stream = await navigator.mediaDevices.getUserMedia(constraints);
    } catch (err) {
      throw new RecorderStartError(classifyMicError(err), err);
    }

    const source = ctx.createMediaStreamSource(stream);
    const workletNode = new AudioWorkletNode(ctx, 'mic-capture');
    node = workletNode;
    workletNode.port.onmessage = (
      event: MessageEvent<{ type: string; data: Int16Array; peak?: number }>,
    ) => {
      if (event.data.type === 'pcm') onBatch(event.data.data, event.data.peak ?? 0);
    };
    // An unplugged or revoked microphone ends its track without any error elsewhere.
    stream.getAudioTracks().forEach((t) => t.addEventListener('ended', onInputEnded));

    source.connect(workletNode);
    // Do NOT connect workletNode to destination — we don't want mic monitoring.
    return { close };
  } catch (err) {
    close();
    throw err;
  }
}
