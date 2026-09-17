import { useRef, useState } from 'react';
import type { SummaryErrorCode, SummaryResult, SummaryStateResult } from '../../shared/ipc-types';

export interface SummaryState {
  filePath: string | null;
  error: SummaryErrorCode | null;
  /** A paid, rendered document is held in main and can be saved without paying again. */
  canRetrySave: boolean;
}
const EMPTY: SummaryState = { filePath: null, error: null, canRetrySave: false };

/** Mounted by App so in-flight results survive navigation between views/jobs. */
export function useSummary() {
  const [results, setResults] = useState<Record<string, SummaryState>>({});
  const [generatingJobId, setGeneratingJobId] = useState<string | null>(null);
  const busy = useRef(false);
  const update = (jobId: string, change: Partial<SummaryState>) => {
    setResults(previous => ({ ...previous, [jobId]: { ...(previous[jobId] ?? EMPTY), ...change } }));
  };
  const apply = (jobId: string, result: SummaryResult) => {
    if (result.status === 'saved') update(jobId, { filePath: result.filePath, error: null, canRetrySave: false });
    if (result.status === 'error') update(jobId, { error: result.error, canRetrySave: result.canRetrySave ?? false });
  };

  const run = async (jobId: string, channel: 'summary:generate' | 'summary:retry-save') => {
    if (busy.current) return;
    busy.current = true;
    setGeneratingJobId(jobId);
    // A new attempt must clear the previous path, or a failure leaves a live Open
    // button pointing at a document the banner implies is the new one.
    update(jobId, { error: null, filePath: null });
    try {
      apply(jobId, await window.electronAPI.invoke(channel, { jobId }) as SummaryResult);
    } catch { update(jobId, { error: 'provider_error' }); }
    finally { busy.current = false; setGeneratingJobId(null); }
  };

  const generate = (jobId: string) => run(jobId, 'summary:generate');
  const retrySave = (jobId: string) => run(jobId, 'summary:retry-save');

  /**
   * Recover what main already knows for this job. A renderer reload during a
   * generation would otherwise orphan a document that was paid for and saved.
   */
  const refresh = async (jobId: string) => {
    try {
      const state = await window.electronAPI.invoke('summary:state', { jobId }) as SummaryStateResult;
      if (state.filePath || state.canRetrySave) {
        update(jobId, { filePath: state.filePath, canRetrySave: state.canRetrySave });
      }
    } catch { /* main is the source of truth; absence of an answer changes nothing */ }
  };

  const open = async (jobId: string) => {
    try {
      const result = await window.electronAPI.invoke('summary:open', { jobId }) as { opened: boolean };
      update(jobId, { error: result.opened ? null : 'open_failed' });
    } catch { update(jobId, { error: 'open_failed' }); }
  };

  return { getState: (jobId: string) => results[jobId] ?? EMPTY, generatingJobId, generate, retrySave, refresh, open };
}
