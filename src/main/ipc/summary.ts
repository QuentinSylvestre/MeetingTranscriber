import { BrowserWindow, dialog, ipcMain, shell } from 'electron';
import { promises as fs } from 'fs';
import log from 'electron-log';
import * as path from 'path';
import type { SummaryResult, SummaryStateResult } from '../../shared/ipc-types';
import { SECRET_KEY_NAMES } from '../../shared/ipc-types';
import { getJob, updateJobCost } from '../db/jobs';
import { getSummaryRecord, saveSummaryRecord } from '../db/summaries';
import { getSpeakerMappings, getTranscript } from '../db/transcript';
import { calculateSummaryCost } from '../pricing/calculate';
import { getPreference, getSecretPlaintext } from '../settings/store';
import { checkTranscript, generateSummary, SummaryError } from '../summary/generate';
import { renderSummaryDocx } from '../summary/render-docx';
import type { MeetingSummary } from '../summary/schema';
import { summaryFilename, summaryTranscript } from '../summary/transcript';

/**
 * Replace the destination only once the bytes are safely on disk. Writing in place
 * truncates the previous document first, so a failure halfway through would destroy
 * both the old report and the paid new one.
 */
async function writeAtomically(filePath: string, buffer: Buffer): Promise<void> {
  const temporary = path.join(path.dirname(filePath), `.${path.basename(filePath)}.${process.pid}.tmp`);
  try {
    await fs.writeFile(temporary, buffer);
    await fs.rename(temporary, filePath);
  } catch (error) {
    await fs.rm(temporary, { force: true }).catch(() => {});
    throw error;
  }
}

/**
 * Module-level (not per-registration) so it survives independently of any one
 * `registerSummaryHandlers()` call and can be inspected by tests: holds the
 * pre-render summary JSON + transcript snapshot for exactly the window where
 * `saveSummaryRecord` threw right after a paid `generateSummary()` call. This is a
 * narrow, session-only safety net — it is never written to disk itself, so it does
 * not survive an app restart the way a successful `job_summaries` write would.
 * `summary:rerender` re-attempts the persist from here when no durable record exists.
 *
 * `costUsd` covers a distinct sub-case: `saveSummaryRecord` succeeded (the record
 * itself is durable) but the subsequent `updateJobCost` call threw. The record does
 * not need retrying then — only the cost does — so an entry can carry `costUsd`
 * alone while `summaryJson`/`transcript` are stale copies of an already-saved record.
 * `updateJobCost` is a cumulative increment, not a set, so `costUsd` must be applied
 * at most once and cleared immediately after, never re-applied on a later retry.
 *
 * Exported (not closure-scoped like `busy`/`savedPaths` below) purely so tests can
 * inspect/seed it directly; see the comment on `busy`'s declaration.
 */
export const pendingPersist = new Map<string, { summaryJson: string; transcript: string; costUsd?: number }>();

/**
 * Reads OpenAI Responses API's input_tokens/output_tokens/input_tokens_details.cached_tokens
 * off the given value defensively (it is typed `unknown` at the `onUsage` callback
 * boundary) and returns `calculateSummaryCost()`'s result only when the shape parses
 * successfully. Returns `undefined` — never `0` — on a missing/malformed shape: an
 * absent usage field must never silently compute as a real, defined zero cost (mirrors
 * this project's identical rule for transcription cost).
 */
function parseOpenAiUsage(usage: unknown): number | undefined {
  if (typeof usage !== 'object' || usage === null) {
    log.warn('Summary: usage field missing or not an object; cost not recorded');
    return undefined;
  }
  const raw = usage as Record<string, unknown>;
  const inputTokens = raw.input_tokens;
  const outputTokens = raw.output_tokens;
  if (typeof inputTokens !== 'number' || typeof outputTokens !== 'number') {
    log.warn('Summary: usage field missing input_tokens/output_tokens; cost not recorded');
    return undefined;
  }
  let cachedTokens: number | undefined;
  const details = raw.input_tokens_details;
  if (typeof details === 'object' && details !== null) {
    const rawCached = (details as Record<string, unknown>).cached_tokens;
    if (typeof rawCached === 'number') cachedTokens = rawCached;
  }
  const rates = getPreference('pricingRates');
  const cost = calculateSummaryCost({ inputTokens, outputTokens, cachedTokens }, rates);
  log.info(`Summary: usage input=${inputTokens} output=${outputTokens} cached=${cachedTokens ?? 0} cost=$${cost.toFixed(4)}`);
  return cost;
}

export function registerSummaryHandlers(): void {
  // Closure-scoped, unlike `pendingPersist` above: nothing outside this module needs
  // to inspect `busy`/`savedPaths` directly (tests drive them only through the IPC
  // handlers), so they don't need module-level export. This app is single-instance
  // locked, so the scoping mismatch has no behavioral effect either way.
  let busy = false;
  // Only paths chosen by the native save dialog and successfully written here
  // can be opened. The renderer cannot ask shell.openPath to open an arbitrary file.
  const savedPaths = new Map<string, string>();

  const save = async (event: Electron.IpcMainInvokeEvent, jobId: string, title: string, buffer: Buffer)
  : Promise<SummaryResult> => {
    const options = {
      title: 'Enregistrer le compte rendu du conseil',
      defaultPath: summaryFilename(title),
      filters: [{ name: 'Document Word', extensions: ['docx'] }],
    };
    const win = BrowserWindow.fromWebContents(event.sender);
    const destination = await (win ? dialog.showSaveDialog(win, options) : dialog.showSaveDialog(options));
    if (destination.canceled || !destination.filePath) {
      return { status: 'error', error: 'save_failed' };
    }
    // Reject an explicit non-DOCX extension rather than writing misleading bytes.
    if (path.extname(destination.filePath).toLowerCase() !== '.docx') {
      return { status: 'error', error: 'bad_extension' };
    }
    try {
      await writeAtomically(destination.filePath, buffer);
    } catch (error) {
      log.error(`Summary: could not write the document (${error instanceof Error ? error.message : 'unknown'})`);
      return { status: 'error', error: 'save_failed' };
    }
    savedPaths.set(jobId, destination.filePath);
    return { status: 'saved', filePath: destination.filePath };
  };

  ipcMain.handle('summary:generate', async (event, request: { jobId: string }): Promise<SummaryResult> => {
    if (busy) return { status: 'error', error: 'busy' };
    busy = true;
    try {
      if (!request || typeof request.jobId !== 'string') throw new SummaryError('empty_transcript');
      const job = getJob(request.jobId);
      if (!job || job.status !== 'done') throw new SummaryError('empty_transcript');
      const turns = getTranscript(job.id);
      const transcript = summaryTranscript(turns, getSpeakerMappings(job.id));
      checkTranscript(transcript);
      const apiKey = getSecretPlaintext(SECRET_KEY_NAMES.openai);
      if (!apiKey) throw new SummaryError('missing_key');
      // The destination is chosen before the request so cancelling costs nothing.
      const options = {
        title: 'Enregistrer le compte rendu du conseil',
        defaultPath: summaryFilename(job.title),
        filters: [{ name: 'Document Word', extensions: ['docx'] }],
      };
      const win = BrowserWindow.fromWebContents(event.sender);
      const destination = await (win ? dialog.showSaveDialog(win, options) : dialog.showSaveDialog(options));
      if (destination.canceled || !destination.filePath) return { status: 'canceled' };
      if (path.extname(destination.filePath).toLowerCase() !== '.docx') {
        // Nothing has been sent yet, so this costs the user nothing.
        return { status: 'error', error: 'bad_extension' };
      }
      const durationMs = turns.reduce((end, turn) => Math.max(end, turn.end_ms), 0);
      let costUsd: number | undefined;
      const summary = await generateSummary(transcript, apiKey, durationMs, {
        onUsage: usage => { costUsd = parseOpenAiUsage(usage); },
      });
      // From here the request is billed, so a local failure must never be reported as
      // a provider problem and must never discard the document that was paid for.
      // Persisting happens before rendering/writing: a render or write failure below
      // must still leave the paid result recoverable via 'summary:rerender'.
      const summaryJson = JSON.stringify(summary);
      // A cost from an earlier generation of this same job can already be sitting
      // here (its own updateJobCost call failed after a successful saveSummaryRecord
      // — see below). That earlier cost is unrelated to whether *this* attempt's
      // saveSummaryRecord succeeds, so it must be folded in and carried forward
      // either way rather than silently dropped by the .delete()/.set() below.
      const priorPendingCost = pendingPersist.get(job.id)?.costUsd;
      const combinedCost = priorPendingCost !== undefined ? (costUsd ?? 0) + priorPendingCost : costUsd;
      try {
        saveSummaryRecord(job.id, summaryJson, transcript);
      } catch (persistError) {
        // Deliberately its own try/catch, separate from updateJobCost and the
        // render/write logic below: an uncaught throw here must never fall into this
        // handler's outer catch-all, which maps unknown errors to 'provider_error' —
        // that would misreport a local failure that has nothing to do with the
        // provider. The record was never saved, so the whole result — including any
        // computed (and any still-unapplied prior) cost — must stay recoverable.
        log.error(`Summary: failed to persist job_summaries record: ${persistError}`);
        pendingPersist.set(job.id, { summaryJson, transcript, costUsd: combinedCost });
        return { status: 'error', error: 'persist_failed' };
      }
      // The record IS durably saved from here on. A failure below is a separate,
      // non-fatal bookkeeping problem — it must never be reported as 'persist_failed'
      // (that error's own text says "it could not be saved... a new request will be
      // charged", which is actively wrong once the record is safely on disk and would
      // invite an unnecessary real re-bill).
      pendingPersist.delete(job.id); // clears the stale fallback now folded into combinedCost above
      if (combinedCost !== undefined) {
        try {
          updateJobCost(job.id, combinedCost);
        } catch (costError) {
          log.error(`Summary: failed to update job cost for job ${job.id}: ${costError}`);
          // Stash just the cost (paired with this generation's now-durable summary/
          // transcript, simplest to store as one entry) so 'summary:rerender's
          // fallback can retry applying it without re-persisting the record.
          pendingPersist.set(job.id, { summaryJson, transcript, costUsd: combinedCost });
        }
      }
      let buffer: Buffer;
      try {
        buffer = await renderSummaryDocx(summary, transcript);
      } catch (error) {
        log.error(`Summary: rendering failed (${error instanceof Error ? error.message : 'unknown'})`);
        throw new SummaryError('render_failed');
      }
      try {
        await writeAtomically(destination.filePath, buffer);
      } catch (error) {
        log.error(`Summary: could not write the document (${error instanceof Error ? error.message : 'unknown'})`);
        return { status: 'error', error: 'save_failed' };
      }
      savedPaths.set(job.id, destination.filePath);
      return { status: 'saved', filePath: destination.filePath };
    } catch (error) {
      return { status: 'error', error: error instanceof SummaryError ? error.code : 'provider_error' };
    } finally { busy = false; }
  });

  // Re-render and re-save a compte-rendu from its durably persisted JSON + transcript
  // snapshot. No provider request: this is the sole recovery/regeneration path now
  // that 'summary:retry-save' and its in-memory-only buffer are gone. Guarded by the
  // same `busy` flag as 'summary:generate' so the two can never race on one job.
  ipcMain.handle('summary:rerender', async (event, request: { jobId: string }): Promise<SummaryResult> => {
    if (busy) return { status: 'error', error: 'busy' };
    busy = true;
    try {
      // Top-level safety net around this entire handler body, wrapping the two more
      // specific inner try/catches below without changing their behavior. This
      // channel makes no provider request at all, so an unexpected local error here
      // (e.g. getSummaryRecord/getJob throwing on a DB fault) must never propagate
      // out of the handler uncaught — useSummary.ts's generic catch would otherwise
      // report it as 'provider_error', actively misleading the user with text about
      // checking the API key/model access/connection/quota for a channel that never
      // talks to a provider.
      try {
        const jobId = typeof request?.jobId === 'string' ? request.jobId : '';
        let record = getSummaryRecord(jobId);
        const pending = pendingPersist.get(jobId);
        // A pending entry needs its summary/transcript persisted whenever it isn't
        // already reflected in the durable record — either there is no record yet
        // (a prior 'persist_failed' with nothing durable at all), or there IS one but
        // it's now stale: a *newer* paid generation's saveSummaryRecord failed while
        // an older generation's record is still what's on disk. Comparing the JSON
        // rather than just checking `!record` matters — otherwise that newer,
        // already-paid-for content would be silently dropped below (case (b)'s
        // cost-only cleanup would delete the whole entry without ever saving it).
        if (pending && (!record || record.summary_json !== pending.summaryJson)) {
          try {
            // Upsert: replaces any older record for this job, per SC-8 ("only the
            // latest is retained") — correct here even when a record already exists.
            saveSummaryRecord(jobId, pending.summaryJson, pending.transcript);
            record = getSummaryRecord(jobId);
          } catch (retryError) {
            // The paid result is still sitting in pendingPersist (left untouched
            // here — never cleared on this failure path), so this must not fall
            // through to 'no_stored_summary': that would claim nothing was ever
            // generated and could invite a needless, real, paid re-generation.
            // 'persist_failed' is accurate instead — the content exists but still
            // can't be persisted, the same situation that error text was written for.
            log.error(`Summary: retrying pending persist for job ${jobId} failed: ${retryError}`);
            return { status: 'error', error: 'persist_failed' };
          }
        }
        // A pending cost can exist whenever the record is durable, whether that's
        // because the retry just above succeeded, or because it was already durable
        // and only summary:generate's own updateJobCost call had failed. Apply it
        // exactly once, then drop it: updateJobCost is a cumulative increment, so
        // re-applying it on a later rerender would double-count real money.
        if (record && pending) {
          if (pending.costUsd !== undefined) {
            try {
              updateJobCost(jobId, pending.costUsd);
              pendingPersist.delete(jobId);
            } catch (costError) {
              log.error(`Summary: retrying pending cost update for job ${jobId} failed: ${costError}`);
              // Leave it pending for a later rerender to retry. The record itself is
              // durable regardless, so this must not block rendering/saving below.
            }
          } else {
            pendingPersist.delete(jobId); // summary/transcript now durably saved above; nothing left to retry
          }
        }
        if (!record) return { status: 'error', error: 'no_stored_summary' };
        const job = getJob(jobId);
        let buffer: Buffer;
        try {
          const summary = JSON.parse(record.summary_json) as MeetingSummary;
          buffer = await renderSummaryDocx(summary, record.transcript_snapshot);
        } catch (error) {
          log.error(`Summary: rerender failed: ${error instanceof Error ? error.message : 'unknown'}`);
          return { status: 'error', error: 'render_failed' };
        }
        log.info('Summary: rerendered from stored record, no provider request');
        return save(event, jobId, job?.title ?? 'conseil-municipal', buffer);
      } catch (error) {
        log.error(`Summary: rerender encountered an unexpected local error: ${error instanceof Error ? error.message : 'unknown'}`);
        return { status: 'error', error: 'rerender_failed' };
      }
    } finally { busy = false; }
  });

  // Lets a reloaded renderer recover a document the main process already saved, and
  // learn whether a durably persisted record exists for this job. `filePath` is
  // remembered only for this session; `hasStoredSummary` reflects the database and so
  // survives a restart.
  ipcMain.handle('summary:state', async (_event, request: { jobId: string }): Promise<SummaryStateResult> => {
    const jobId = typeof request?.jobId === 'string' ? request.jobId : '';
    const filePath = savedPaths.get(jobId) ?? null;
    const hasStoredSummary = getSummaryRecord(jobId) !== null || pendingPersist.has(jobId);
    return { filePath, hasStoredSummary, busy };
  });

  ipcMain.handle('summary:open', async (_event, request: { jobId: string }) => {
    const filePath = typeof request?.jobId === 'string' ? savedPaths.get(request.jobId) : undefined;
    if (!filePath) return { opened: false };
    try { return { opened: (await shell.openPath(filePath)) === '' }; }
    catch { return { opened: false }; }
  });
}
