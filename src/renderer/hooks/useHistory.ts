import { useState, useEffect, useCallback } from 'react';
import type { Job } from '../../shared/ipc-types';

export function useHistory() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const loaded = await window.electronAPI.invoke('db:list-jobs') as Job[];
      setJobs(loaded);
    } catch (err) {
      console.error('useHistory load error:', err);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const deleteJob = useCallback(async (jobId: string) => {
    await window.electronAPI.invoke('db:delete-job', { id: jobId });
    await refresh();
  }, [refresh]);

  const renameJob = useCallback(async (jobId: string, newTitle: string) => {
    // Update state ONLY after the IPC call succeeds (not optimistic before await)
    await window.electronAPI.invoke('db:update-job-title', { id: jobId, title: newTitle });
    setJobs(prev => prev.map(j => j.id === jobId ? { ...j, title: newTitle } : j));
  }, []);

  return { jobs, loading, error, refresh, deleteJob, renameJob };
}
