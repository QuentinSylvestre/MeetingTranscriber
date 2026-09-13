// naudiodon: FAIL (Phase 1 ABI spike) — WASAPI loopback disabled for v1.
// No prebuilt for Electron 36 ABI 135; native build requires Windows SDK 10.0.26100.0.
// This stub is a drop-in replacement that reports unavailability gracefully.
// When naudiodon becomes available in a future Electron version, replace this file
// with the real implementation and remove the LoopbackDisabled export.
import log from 'electron-log';

/**
 * Whether WASAPI loopback capture is available on this system.
 * Always false for v1 (naudiodon ABI incompatible with Electron 36).
 */
export const loopbackAvailable = false;

/**
 * Stub: start loopback capture to the given output path.
 * Logs a warning and returns without doing anything.
 */
export function startLoopback(_outputPath: string): void {
  log.warn(
    'WASAPI loopback requested but naudiodon is unavailable ' +
    '(no prebuilt for Electron 36 ABI 135). Loopback disabled for v1.'
  );
  // No-op — mic-only recording proceeds
}

/**
 * Stub: stop loopback capture. No-op.
 */
export function stopLoopback(): void {
  // No-op
}
