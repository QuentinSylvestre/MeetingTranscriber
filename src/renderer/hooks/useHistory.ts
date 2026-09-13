import { useState, useEffect, useCallback } from 'react';
import type { Job } from '../../shared/ipc-types';

export function useHistory() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const loaded = await window.electronAPI.invoke('db:list-jobs') as Job[];
      setJobs(loaded);
    } catch (err) {
      console.error('useHistory load error:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const deleteJob = useCallback(async (jobId: string) => {
    await window.electronAPI.invoke('db:delete-job', { id: jobId });
    await refresh();
  }, [refresh]);

  return { jobs, loading, refresh, deleteJob };
}
