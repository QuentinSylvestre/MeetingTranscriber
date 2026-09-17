import { BrowserWindow, dialog, ipcMain, shell } from 'electron';
import { promises as fs } from 'fs';
import log from 'electron-log';
import * as path from 'path';
import type { SummaryResult } from '../../shared/ipc-types';
import { SECRET_KEY_NAMES } from '../../shared/ipc-types';
import { getJob } from '../db/jobs';
import { getSpeakerMappings, getTranscript } from '../db/transcript';
import { getSecretPlaintext } from '../settings/store';
import { checkTranscript, generateSummary, SummaryError } from '../summary/generate';
import { renderSummaryDocx } from '../summary/render-docx';
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

export function registerSummaryHandlers(): void {
  let busy = false;
  // Only paths chosen by the native save dialog and successfully written here
  // can be opened. The renderer cannot ask shell.openPath to open an arbitrary file.
  const savedPaths = new Map<string, string>();
  // A rendered document that could not be written is kept so the user can choose
  // another destination without paying for a second generation.
  const unsaved = new Map<string, Buffer>();

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
      unsaved.set(jobId, buffer);
      return { status: 'error', error: 'save_failed', canRetrySave: true };
    }
    // Reject an explicit non-DOCX extension rather than writing misleading bytes.
    if (path.extname(destination.filePath).toLowerCase() !== '.docx') {
      unsaved.set(jobId, buffer);
      return { status: 'error', error: 'bad_extension', canRetrySave: true };
    }
    try {
      await writeAtomically(destination.filePath, buffer);
    } catch (error) {
      log.error(`Summary: could not write the document (${error instanceof Error ? error.message : 'unknown'})`);
      unsaved.set(jobId, buffer);
      return { status: 'error', error: 'save_failed', canRetrySave: true };
    }
    unsaved.delete(jobId);
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
      const summary = await generateSummary(transcript, apiKey, durationMs);
      // From here the request is billed, so a local failure must never be reported as
      // a provider problem and must never discard the document that was paid for.
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
        unsaved.set(job.id, buffer);
        return { status: 'error', error: 'save_failed', canRetrySave: true };
      }
      savedPaths.set(job.id, destination.filePath);
      return { status: 'saved', filePath: destination.filePath };
    } catch (error) {
      return { status: 'error', error: error instanceof SummaryError ? error.code : 'provider_error' };
    } finally { busy = false; }
  });

  // Re-save a document that was already paid for and rendered. No provider request.
  ipcMain.handle('summary:retry-save', async (event, request: { jobId: string }): Promise<SummaryResult> => {
    const jobId = typeof request?.jobId === 'string' ? request.jobId : '';
    const buffer = unsaved.get(jobId);
    if (!buffer) return { status: 'error', error: 'save_failed' };
    const job = getJob(jobId);
    return save(event, jobId, job?.title ?? 'conseil-municipal', buffer);
  });

  // Lets a reloaded renderer recover a document the main process already saved, and
  // learn that an unsaved one is still held. Paths are remembered for this session only.
  ipcMain.handle('summary:state', async (_event, request: { jobId: string }) => {
    const jobId = typeof request?.jobId === 'string' ? request.jobId : '';
    const filePath = savedPaths.get(jobId) ?? null;
    return { filePath, canRetrySave: unsaved.has(jobId), busy };
  });

  ipcMain.handle('summary:open', async (_event, request: { jobId: string }) => {
    const filePath = typeof request?.jobId === 'string' ? savedPaths.get(request.jobId) : undefined;
    if (!filePath) return { opened: false };
    try { return { opened: (await shell.openPath(filePath)) === '' }; }
    catch { return { opened: false }; }
  });
}
