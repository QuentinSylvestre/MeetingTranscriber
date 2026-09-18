import { ipcMain, dialog, clipboard, BrowserWindow } from 'electron';
import * as fs from 'fs';
import log from 'electron-log';
import { getTranscript, getSpeakerMappings } from '../db/transcript';
import { getJob } from '../db/jobs';
import { readPreferences } from '../settings/store';
import { renderTranscriptDocx, transcriptLines } from '../export/transcript-docx';

export { formatLine } from './format-line'; // re-exported so callers don't need to know format-line directly

function formatTranscript(jobId: string, includeTimestamps: boolean): string {
  const turns = getTranscript(jobId);
  const mappings = getSpeakerMappings(jobId);
  return transcriptLines(turns, mappings, includeTimestamps).join('\n');
}

/** Windows reserved device names. */
const WINDOWS_RESERVED = /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(\..*)?$/i;

export function registerExportHandlers(): void {
  ipcMain.handle('export:to-file', async (_event, { jobId }: { jobId: string }) => {
    const job = getJob(jobId);
    if (!job) throw new Error(`Job not found: ${jobId}`);

    const sanitizedTitle = job.title
      .replace(/[<>:"/\\|?*]/g, '_') // illegal Windows filename chars
      .replace(/[.\s]+$/, '')         // trailing dots/spaces (Windows rejects these)
      .trim()
      || 'transcript';                // fallback if the whole title was stripped

    const filename = WINDOWS_RESERVED.test(sanitizedTitle)
      ? `transcript_${sanitizedTitle}`
      : sanitizedTitle;
    const defaultPath = `${filename}.docx`;

    const win = BrowserWindow.getAllWindows()[0];
    const result = await dialog.showSaveDialog(win, {
      title: 'Export Transcript',
      defaultPath,
      filters: [{ name: 'Word Document', extensions: ['docx'] }],
    });

    if (result.canceled || !result.filePath) return { exported: false };

    const { includeTimestamps } = readPreferences();
    const turns = getTranscript(jobId);
    const mappings = getSpeakerMappings(jobId);
    const buffer = await renderTranscriptDocx(job.title, turns, mappings, includeTimestamps);
    fs.writeFileSync(result.filePath, buffer);
    log.info(`Transcript exported to ${result.filePath}`);
    return { exported: true, filePath: result.filePath };
  });

  ipcMain.handle('export:to-clipboard', (_event, { jobId }: { jobId: string }) => {
    const { includeTimestamps } = readPreferences();
    const text = formatTranscript(jobId, includeTimestamps);
    if (!text.trim()) return { copied: false, reason: 'no_turns' };
    clipboard.writeText(text);
    log.info(`Transcript copied to clipboard for job ${jobId}`);
    return { copied: true };
  });
}
