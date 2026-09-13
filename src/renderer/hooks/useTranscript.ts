import { useState, useCallback, useEffect } from 'react';
import type { TranscriptTurn, SpeakerMapping } from '../../shared/ipc-types';

export function useTranscript(jobId: string | null) {
  const [turns, setTurns] = useState<TranscriptTurn[]>([]);
  const [speakerMappings, setSpeakerMappings] = useState<Map<string, string>>(new Map());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!jobId) { setTurns([]); setSpeakerMappings(new Map()); return; }
    setLoading(true);
    setError(null);
    Promise.all([
      window.electronAPI.invoke('db:get-transcript', { job_id: jobId }) as Promise<TranscriptTurn[]>,
      window.electronAPI.invoke('db:get-speaker-mappings', { job_id: jobId }) as Promise<SpeakerMapping[]>,
    ]).then(([loadedTurns, loadedMappings]) => {
      setTurns(loadedTurns);
      const map = new Map<string, string>();
      for (const m of loadedMappings) {
        map.set(`${m.chunk_index}::${m.speaker_label}`, m.display_name);
      }
      setSpeakerMappings(map);
    }).catch((err) => {
      setError(err instanceof Error ? err.message : String(err));
      console.error('useTranscript load error:', err);
    }).finally(() => setLoading(false));
  }, [jobId]);

  const renameSpeaker = useCallback(async (
    chunkIndex: number,
    speakerLabel: string,
    displayName: string
  ) => {
    if (!jobId) return;
    await window.electronAPI.invoke('db:update-speaker-mapping', {
      job_id: jobId,
      chunk_index: chunkIndex,
      speaker_label: speakerLabel,
      display_name: displayName,
    });
    setSpeakerMappings(prev => {
      const next = new Map(prev);
      next.set(`${chunkIndex}::${speakerLabel}`, displayName);
      return next;
    });
  }, [jobId]);

  const getDisplayName = useCallback((chunkIndex: number, speakerLabel: string): string => {
    return speakerMappings.get(`${chunkIndex}::${speakerLabel}`) || speakerLabel;
  }, [speakerMappings]);

  return { turns, speakerMappings, loading, error, renameSpeaker, getDisplayName };
}
