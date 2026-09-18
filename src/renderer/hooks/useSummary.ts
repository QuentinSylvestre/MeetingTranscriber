import { useRef, useState } from 'react';
import type { SummaryErrorCode, SummaryResult, SummaryStateResult } from '../../shared/ipc-types';

export interface SummaryState {
  filePath: string | null;
  error: SummaryErrorCode | null;
  /** A validated summary + transcript snapshot is durably persisted for this job, so
   *  'summary:rerender' can rebuild and re-save its docx at any time — including
   *  after a restart — without a new LLM call. */
  hasStoredSummary: boolean;
}
const EMPTY: SummaryState = { filePath: null, error: null, hasStoredSummary: false };

/** Mounted by App so in-flight results survive navigation between views/jobs. */
export function useSummary() {
  const [results, setResults] = useState<Record<string, SummaryState>>({});
  const [generatingJobId, setGeneratingJobId] = useState<string | null>(null);
  const busy = useRef(false);
  const update = (jobId: string, change: Partial<SummaryState>) => {
    setResults(previous => ({ ...previous, [jobId]: { ...(previous[jobId] ?? EMPTY), ...change } }));
  };
  const apply = (jobId: string, result: SummaryResult) => {
    if (result.status === 'saved') update(jobId, { filePath: result.filePath, error: null });
    if (result.status === 'error') update(jobId, { error: result.error });
  };

  /**
   * Recover what main already knows for this job: a durable 'hasStoredSummary' flag
   * (survives a restart) and a session-only saved file path. A renderer reload during
   * a generation would otherwise orphan a document that was paid for and saved.
   */
  const refresh = async (jobId: string) => {
    try {
      const state = await window.electronAPI.invoke('summary:state', { jobId }) as SummaryStateResult;
      if (state.filePath || state.hasStoredSummary) {
        update(jobId, { filePath: state.filePath, hasStoredSummary: state.hasStoredSummary });
      }
    } catch { /* main is the source of truth; absence of an answer changes nothing */ }
  };

  const run = async (jobId: string, channel: 'summary:generate' | 'summary:rerender') => {
    if (busy.current) return;
    busy.current = true;
    setGeneratingJobId(jobId);
    // A new attempt must clear the previous path, or a failure leaves a live Open
    // button pointing at a document the banner implies is the new one.
    update(jobId, { error: null, filePath: null });
    try {
      apply(jobId, await window.electronAPI.invoke(channel, { jobId }) as SummaryResult);
    } catch { update(jobId, { error: 'provider_error' }); }
    finally {
      // Re-sync 'hasStoredSummary' with main's ground truth regardless of outcome: a
      // persisted record can now exist even on a 'save_failed'/'render_failed' error
      // (persistence happens before rendering), so the Régénérer affordance must
      // become available immediately, not only after the next mount-time refresh.
      await refresh(jobId);
      busy.current = false; setGeneratingJobId(null);
    }
  };

  const generate = (jobId: string) => run(jobId, 'summary:generate');
  const rerender = (jobId: string) => run(jobId, 'summary:rerender');

  const open = async (jobId: string) => {
    try {
      const result = await window.electronAPI.invoke('summary:open', { jobId }) as { opened: boolean };
      update(jobId, { error: result.opened ? null : 'open_failed' });
    } catch { update(jobId, { error: 'open_failed' }); }
  };

  return { getState: (jobId: string) => results[jobId] ?? EMPTY, generatingJobId, generate, rerender, refresh, open };
}
