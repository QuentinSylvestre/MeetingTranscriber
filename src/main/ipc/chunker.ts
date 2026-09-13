import { ipcMain, app } from 'electron';
import * as path from 'path';
import { chunkAudio } from '../chunker/index';
import { getPreference } from '../settings/store';
import log from 'electron-log';
import type { ProviderName } from '../../shared/ipc-types';

export function registerChunkerHandlers(): void {
  ipcMain.handle(
    'chunker:split',
    async (
      _event,
      { inputPath, provider, outputDir }: {
        inputPath: string;
        provider: ProviderName;
        outputDir: string;
      }
    ) => {
      // F1: Validate inputPath is a local filesystem path (not a URL, named pipe, etc.).
      // Uploaded files may come from any directory the user selected via a system dialog —
      // we allow absolute paths from anywhere and only reject clearly non-file schemes.
      if (
        inputPath.startsWith('http://') ||
        inputPath.startsWith('https://') ||
        inputPath.startsWith('\\\\.\\')
      ) {
        throw new Error('inputPath must be a local filesystem path, not a URL or named pipe');
      }
      if (!path.isAbsolute(inputPath)) {
        throw new Error('inputPath must be an absolute filesystem path');
      }

      // F2: Validate outputDir is confined to app.getPath('userData') or recordingsFolder.
      const recordingsFolder = getPreference('recordingsFolder');
      const userDataPath = app.getPath('userData');
      const resolvedOutputDir = path.resolve(outputDir);
      const resolvedUserData = path.resolve(userDataPath);
      const resolvedRecordings = path.resolve(recordingsFolder);

      const isUnderUserData =
        resolvedOutputDir === resolvedUserData ||
        resolvedOutputDir.startsWith(resolvedUserData + path.sep);
      const isUnderRecordings =
        resolvedOutputDir === resolvedRecordings ||
        resolvedOutputDir.startsWith(resolvedRecordings + path.sep);

      if (!isUnderUserData && !isUnderRecordings) {
        throw new Error(
          `outputDir must be under userData or recordingsFolder. Got: ${outputDir}`
        );
      }

      const resolvedInput = path.resolve(inputPath);
      log.info(`chunker:split: ${resolvedInput} -> ${resolvedOutputDir} (provider: ${provider})`);
      return chunkAudio(inputPath, provider, outputDir);
    }
  );
}
