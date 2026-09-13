import { ipcMain } from 'electron';
import * as runner from '../transcription/runner';
import log from 'electron-log';

export function registerTranscriptionHandlers(): void {
  ipcMain.handle('transcription:start-job', async (_event, opts) => {
    await runner.startJob(opts);
  });

  ipcMain.handle('transcription:cancel-job', () => {
    runner.cancelJob();
  });

  ipcMain.handle('transcription:get-progress', (_event, { jobId }: { jobId: string }) => {
    const activeId = runner.getActiveJobId();
    return {
      jobId,
      status: activeId === jobId ? 'running' : 'idle',
    };
  });
}
