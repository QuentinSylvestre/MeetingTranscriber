import * as path from 'path';
import { ipcMain, app } from 'electron';
import * as runner from '../transcription/runner';
import { getStatus as getRecorderStatus } from '../recorder/index';
import { getPreference } from '../settings/store';
import log from 'electron-log';

export function registerTranscriptionHandlers(): void {
  ipcMain.handle('transcription:start-job', async (_event, opts) => {
    const { audioPath } = opts as { audioPath: string };

    // F1 Reliability: mutual exclusion — reject if recorder is active.
    const recorderStatus = getRecorderStatus();
    if (recorderStatus !== 'idle') {
      throw new Error('Cannot start transcription while recording is in progress');
    }

    // F3 Security: audioPath validation.
    if (!path.isAbsolute(audioPath)) {
      throw new Error('audioPath must be an absolute path');
    }
    if (audioPath.startsWith('//') || audioPath.startsWith('\\\\')) {
      throw new Error('UNC paths are not allowed');
    }
    const recordingsFolder = getPreference('recordingsFolder');
    const userData = app.getPath('userData');
    const resolvedAudio = path.resolve(audioPath);
    const resolvedRecordings = path.resolve(recordingsFolder);
    const resolvedUserData = path.resolve(userData);
    const underRecordings = resolvedAudio.startsWith(resolvedRecordings + path.sep)
      || resolvedAudio.startsWith(resolvedRecordings + '/');
    const underUserData = resolvedAudio.startsWith(resolvedUserData + path.sep)
      || resolvedAudio.startsWith(resolvedUserData + '/');
    if (!underRecordings && !underUserData) {
      throw new Error('audioPath must be under recordings folder or app data');
    }

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
