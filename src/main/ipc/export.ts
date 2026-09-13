import { ipcMain, dialog, clipboard, BrowserWindow } from 'electron';
import * as fs from 'fs';
import log from 'electron-log';
import { getTranscript, getSpeakerMappings } from '../db/transcript';
import { getJob } from '../db/jobs';

/** Format a duration in milliseconds as [HH:MM:SS] */
function formatTime(ms: number): string {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `[${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}]`;
}

function formatTranscript(jobId: string): string {
  const turns = getTranscript(jobId);
  const mappings = getSpeakerMappings(jobId);
  const nameMap = new Map<string, string>();
  for (const m of mappings) {
    nameMap.set(`${m.chunk_index}::${m.speaker_label}`, m.display_name || m.speaker_label);
  }

  return turns
    .map(t => {
      const name = nameMap.get(`${t.chunk_index}::${t.speaker_label}`) || t.speaker_label;
      return `${formatTime(t.start_ms)} ${name}: ${t.text}`;
    })
    .join('\n');
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
    const defaultPath = `${filename}.txt`;

    const win = BrowserWindow.getAllWindows()[0];
    const result = await dialog.showSaveDialog(win, {
      title: 'Export Transcript',
      defaultPath,
      filters: [{ name: 'Text', extensions: ['txt'] }],
    });

    if (result.canceled || !result.filePath) return { exported: false };

    const text = formatTranscript(jobId);
    fs.writeFileSync(result.filePath, text, 'utf-8');
    log.info(`Transcript exported to ${result.filePath}`);
    return { exported: true, filePath: result.filePath };
  });

  ipcMain.handle('export:to-clipboard', (_event, { jobId }: { jobId: string }) => {
    const text = formatTranscript(jobId);
    if (!text.trim()) return { copied: false, reason: 'no_turns' };
    clipboard.writeText(text);
    log.info(`Transcript copied to clipboard for job ${jobId}`);
    return { copied: true };
  });
}
