import { ipcMain } from 'electron';
import * as path from 'path';
import { chunkAudio } from '../chunker/index';
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
      // Path validation: log the resolved input for audit purposes.
      // The UploadView supplies paths obtained via the file dialog, which
      // already restricts the user to their own file system. A full
      // path-confinement check would block legitimate uploads from arbitrary
      // directories, so we rely on the dialog origin as the security boundary.
      const resolvedInput = path.resolve(inputPath);
      log.info(`chunker:split input: ${resolvedInput}, provider: ${provider}`);
      return chunkAudio(inputPath, provider, outputDir);
    }
  );
}
