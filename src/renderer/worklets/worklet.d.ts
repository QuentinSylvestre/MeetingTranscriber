/**
 * Globals of the AudioWorklet scope.
 *
 * These are NOT in TypeScript's DOM lib, which only covers the main-thread side
 * (AudioWorkletNode). The processor side lives in a separate global scope, so it has to
 * be declared here or every worklet file fails to compile. Declared to the extent
 * mic-capture.worklet.ts uses them rather than modelling the whole spec.
 */

declare class AudioWorkletProcessor {
  /** Channel back to the AudioWorkletNode on the main thread. */
  readonly port: MessagePort;
  constructor(options?: AudioWorkletNodeOptions);
}

/**
 * Registers a processor class under the name the AudioWorkletNode constructor uses.
 * Returning false from process() ends the node; returning true keeps it alive.
 */
declare function registerProcessor(
  name: string,
  processorCtor: new (options: AudioWorkletNodeOptions) => AudioWorkletProcessor,
): void;
