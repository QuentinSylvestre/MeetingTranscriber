import { useCallback } from 'react';
import type { ProviderName, ChunkResult } from '../../shared/ipc-types';

export function useUpload() {
  const splitAudio = useCallback(
    async (
      inputPath: string,
      provider: ProviderName,
      outputDir: string
    ): Promise<ChunkResult> => {
      return window.electronAPI.invoke('chunker:split', {
        inputPath,
        provider,
        outputDir,
      }) as Promise<ChunkResult>;
    },
    []
  );

  return { splitAudio };
}
