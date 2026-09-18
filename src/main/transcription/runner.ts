import * as path from 'path';
import * as fs from 'fs';
import log from 'electron-log';
import { BrowserWindow } from 'electron';
import { getProvider } from '../providers/index';
import { chunkAudio } from '../chunker/index';
import { createJob, updateJobStatus, updateJobCost } from '../db/jobs';
import { saveTranscript } from '../db/transcript';
import { getPreference } from '../settings/store';
import { calculateTranscriptionCost } from '../pricing/calculate';
import type { ProviderName, TranscriptTurn, SpeakerCountHint } from '../../shared/ipc-types';

/** One active job at a time. */
let _activeJobId: string | null = null;
let _abortController: AbortController | null = null;

export function getActiveJobId(): string | null { return _activeJobId; }

export function cancelJob(): void {
  _abortController?.abort();
}

export interface StartJobOptions {
  jobId: string;
  title: string;
  audioPath: string;
  provider: ProviderName;
  model: string;
  language: 'fr' | 'en' | 'auto';
  durationS?: number;
  speakerCountHint?: SpeakerCountHint;
}

export async function startJob(opts: StartJobOptions): Promise<void> {
  if (_activeJobId !== null) throw new Error(`Job ${_activeJobId} is already running`);

  const {
    jobId, title, audioPath, provider, model, language, speakerCountHint,
  } = opts;
  // Mutable: real callers (UploadView, RecordView) never pass durationS today, so this
  // starts undefined and is populated below from a single-shot provider's own reported
  // duration (cr.usage.kind === 'duration') the moment it's known — fixing the
  // previously-always-null jobs.duration_s display.
  let durationS = opts.durationS;

  _activeJobId = jobId;
  _abortController = new AbortController();
  const { signal } = _abortController;

  // 90-minute global timeout (plan requirement)
  const jobTimeout = setTimeout(() => {
    log.warn(`Job ${jobId} exceeded 90-minute timeout, aborting`);
    _abortController?.abort();
  }, 90 * 60 * 1000);

  // Create DB job record
  createJob({
    id: jobId,
    title: title || `Recording ${new Date().toLocaleString()}`,
    created_at: Date.now(),
    audio_path: audioPath,
    duration_s: durationS ?? null,
    provider,
    model,
    language,
    status: 'pending',
    error_msg: null,
    chunk_count: 1,
  });

  const sendProgress = (status: string, costUsd?: number) => {
    const win = BrowserWindow.getAllWindows()[0];
    if (win && !win.isDestroyed()) {
      win.webContents.send('transcription:progress', { jobId, status, costUsd });
    }
  };

  const tempChunkPaths: string[] = [];

  try {
    updateJobStatus(jobId, 'uploading');
    sendProgress('Preparing audio...');

    // Chunk the audio for providers that require it.
    // Chunks go under recordingsFolder/.chunks/<jobId>/ to pass path confinement check.
    const recordingsFolder = getPreference('recordingsFolder');
    const rates = getPreference('pricingRates');
    const chunkOutputDir = path.join(recordingsFolder, '.chunks', jobId);
    const chunkResult = await chunkAudio(audioPath, provider, chunkOutputDir);

    // Track temp files for cleanup (excludes the original audioPath)
    tempChunkPaths.push(
      ...chunkResult.paths.filter(p => p !== audioPath)
    );

    updateJobStatus(jobId, 'transcribing');

    // Get provider adapter
    const providerAdapter = getProvider(provider);

    // Transcribe each chunk
    const allTurns: TranscriptTurn[] = [];
    const chunkDurationMs = chunkResult.chunkDurationMs;
    // Starts undefined (not 0): a progress payload sent before any chunk carries usage
    // must omit costUsd entirely, never send a computed $0 — see JobProgressView's
    // "no cost shown, not $0" rule.
    let runningCostUsd: number | undefined;

    // Multi-chunk jobs (openai, google) need chunk-prefixed speaker labels so
    // that Speaker 0 from chunk 0 and Speaker 0 from chunk 1 are distinct keys
    // in speaker_mappings. Single-chunk providers (assemblyai, elevenlabs) skip
    // the prefix to keep labels clean.
    const needsChunkPrefix = chunkResult.paths.length > 1;

    for (let i = 0; i < chunkResult.paths.length; i++) {
      if (signal.aborted) break;
      const chunkPath = chunkResult.paths[i];
      sendProgress(`Transcribing chunk ${i + 1} of ${chunkResult.paths.length}...`);

      const chunkResults = await providerAdapter.transcribeFile(
        chunkPath,
        { language, diarize: true, speakerCountHint, jobId },
        (s) => sendProgress(`Chunk ${i + 1}: ${s}`),
        signal
      );

      // Apply chunk timestamp offset and flatten turns
      const offsetMs = chunkDurationMs === Infinity ? 0 : i * chunkDurationMs;
      for (const cr of chunkResults) {
        for (const turn of cr.turns) {
          // Apply 'Chunk N \u2013 ' prefix (EN-DASH) for multi-chunk providers so that
          // speaker_mappings keys are globally unique across chunks.
          const speakerLabel = needsChunkPrefix
            ? `Chunk ${i} \u2013 ${turn.speakerLabel}`
            : turn.speakerLabel;
          allTurns.push({
            id: `${jobId}-${i}-${allTurns.length}`, // Format: jobId-chunkIndex-turnIndex
            job_id: jobId,
            chunk_index: i,
            speaker_label: speakerLabel,
            start_ms: turn.startMs + offsetMs,
            end_ms: turn.endMs + offsetMs,
            text: turn.text,
            original_text: turn.text,
          });
        }

        // Cost/duration bookkeeping is isolated from turn-processing above: a DB
        // error here (e.g. SQLITE_BUSY) must never discard already-fetched,
        // already-paid-for turns or fail the whole job — cost tracking is
        // secondary to turn-saving. Split into two independent blocks (rather
        // than one shared try/catch) so a DB failure in either one can never
        // suppress the other's work.
        //
        // usage.kind === 'duration' (not a provider-name check) is what excludes
        // OpenAI/Google (always 'tokens') from ever overwriting duration_s with a
        // partial-chunk value; durationS === undefined keeps this write-once should
        // a single-shot provider's response ever carry more than one usage-bearing
        // result. This only correctly reflects the *total* job duration because
        // today's duration-billed providers (AssemblyAI, ElevenLabs) never produce
        // more than one chunk; if a duration-billed provider is ever chunked in the
        // future, this would need to sum across chunks instead of recording only
        // the first chunk's seconds.
        if (cr.usage?.kind === 'duration' && durationS === undefined) {
          // Plain, synchronous, DB-independent assignment — captured before the
          // DB write below (and before the separate cost-bookkeeping block) so a
          // failure in either DB write can never also silently discard this.
          durationS = cr.usage.seconds;
          try {
            updateJobStatus(jobId, 'transcribing', null, durationS);
          } catch (durationError) {
            log.warn(`Job ${jobId}: chunk ${i} duration write failed, continuing without it: ${durationError}`);
          }
        }

        if (cr.usage) {
          try {
            const increment = calculateTranscriptionCost(provider, cr.usage, rates);
            if (increment === null) {
              // A kind mismatch: the provider's response didn't carry the field
              // this provider bills on. Cost is genuinely unknown here — never
              // fall back to a fabricated 0, and never touch cost_usd/runningCostUsd.
              log.warn(`Job ${jobId}: chunk ${i} usage.kind ('${cr.usage.kind}') doesn't match what ${provider} bills on — cost unknown, skipping cost update`);
            } else {
              updateJobCost(jobId, increment);
              runningCostUsd = (runningCostUsd ?? 0) + increment;
            }
          } catch (costError) {
            log.warn(`Job ${jobId}: chunk ${i} cost bookkeeping failed, continuing without it: ${costError}`);
          }
        }
        // Renamed from the bare status string 'transcribing' (Phase 7 review, Fix
        // 7a): that literal fed the same array JobProgressView renders as a visible
        // scrolling log, appearing as a stray, non-descriptive lowercase line. True
        // suppression would require JobProgressView.tsx to stop pushing every
        // received status onto its log (out of this fix's file scope) — this at
        // least makes the line meaningful when it does appear.
        sendProgress(`Chunk ${i + 1} of ${chunkResult.paths.length} complete`, runningCostUsd);
      }
    }

    if (signal.aborted) {
      updateJobStatus(jobId, 'failed', 'Cancelled by user');
      sendProgress('Cancelled');
      return;
    }

    // Save transcript and update status
    saveTranscript(allTurns);
    updateJobStatus(jobId, 'done', null, durationS);
    sendProgress('Done');
    log.info(`Job ${jobId} completed: ${allTurns.length} turns`);

  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    log.error(`Job ${jobId} failed:`, errMsg);
    // Translate technical error messages into actionable user-facing messages
    let userMessage = errMsg;
    if (errMsg.includes('HTTP 429') || errMsg.includes('429')) {
      userMessage = 'API quota exceeded — check your account';
    } else if (errMsg.includes('not configured')) {
      userMessage = `API key not configured for ${provider} — go to Settings`;
    }
    updateJobStatus(jobId, 'failed', userMessage);
    sendProgress(`Error: ${userMessage}`);
    throw err;
  } finally {
    // Cleanup temp chunk files
    for (const p of tempChunkPaths) {
      try { fs.unlinkSync(p); } catch { /* ignore */ }
    }
    // Also try to remove the temp dir
    try {
      const recordingsFolder = getPreference('recordingsFolder');
      const chunkDir = path.join(recordingsFolder, '.chunks', jobId);
      try {
        fs.rmSync(chunkDir, { recursive: true, force: true });
      } catch (e) {
        log.warn(`Failed to remove temp chunk dir ${chunkDir}:`, e);
      }
    } catch { /* ignore if recordingsFolder unavailable */ }

    clearTimeout(jobTimeout);
    _activeJobId = null;
    _abortController = null;
  }
}
