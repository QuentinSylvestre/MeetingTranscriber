import React, { useState } from 'react';
import { useHistory } from '../hooks/useHistory';
import type { Job } from '../../shared/ipc-types';

interface HistoryViewProps {
  onOpenJob: (job: Job) => void;
}

function formatDate(ts: number): string {
  return new Date(ts).toLocaleString();
}

function statusColor(status: string): string {
  switch (status) {
    case 'done': return '#a6e3a1';
    case 'failed': return '#f38ba8';
    default: return '#f9e2af';
  }
}

export default function HistoryView({ onOpenJob }: HistoryViewProps): React.ReactElement {
  const { jobs, loading, error, deleteJob } = useHistory();
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  if (loading) return <div style={{ color: '#cdd6f4' }}>Loading history...</div>;

  return (
    <div style={{ color: '#cdd6f4' }}>
      <h2 style={{ marginTop: 0 }}>History</h2>
      {error && <p style={{ color: '#f38ba8' }}>Failed to load history: {error}</p>}
      {jobs.length === 0 && !error && <p style={{ color: '#585b70' }}>No transcription jobs yet.</p>}
      {jobs.map(job => (
        <div
          key={job.id}
          style={{
            background: '#313244', borderRadius: 8, padding: '12px 16px', marginBottom: 12,
            display: 'flex', alignItems: 'center', gap: 12,
          }}
        >
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 'bold', marginBottom: 2 }}>{job.title}</div>
            <div style={{ fontSize: 11, color: '#585b70' }}>
              {formatDate(job.created_at)} — {job.provider} — <span style={{ color: statusColor(job.status) }}>{job.status}</span>
            </div>
            {job.status === 'failed' && job.error_msg && (
              <div style={{ fontSize: 11, color: '#f38ba8', marginTop: 2 }}>{job.error_msg}</div>
            )}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            {job.status === 'done' && (
              <button
                onClick={() => onOpenJob(job)}
                style={{ background: '#89b4fa', color: '#1e1e2e', border: 'none', borderRadius: 4, padding: '4px 12px', cursor: 'pointer', fontSize: 12 }}
              >
                Open
              </button>
            )}
            {confirmDelete === job.id ? (
              <>
                <button
                  onClick={async () => { await deleteJob(job.id); setConfirmDelete(null); }}
                  style={{ background: '#f38ba8', color: '#1e1e2e', border: 'none', borderRadius: 4, padding: '4px 12px', cursor: 'pointer', fontSize: 12 }}
                >
                  Confirm
                </button>
                <button
                  onClick={() => setConfirmDelete(null)}
                  style={{ background: '#45475a', color: '#cdd6f4', border: 'none', borderRadius: 4, padding: '4px 12px', cursor: 'pointer', fontSize: 12 }}
                >
                  Cancel
                </button>
              </>
            ) : (
              <button
                onClick={() => setConfirmDelete(job.id)}
                disabled={job.status === 'uploading' || job.status === 'transcribing'}
                title={(job.status === 'uploading' || job.status === 'transcribing') ? 'Cannot delete an active job' : 'Delete this job'}
                style={{
                  background: '#45475a', color: '#cdd6f4', border: 'none', borderRadius: 4,
                  padding: '4px 12px', fontSize: 12,
                  opacity: (job.status === 'uploading' || job.status === 'transcribing') ? 0.4 : 1,
                  cursor: (job.status === 'uploading' || job.status === 'transcribing') ? 'not-allowed' : 'pointer',
                }}
              >
                Delete
              </button>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
