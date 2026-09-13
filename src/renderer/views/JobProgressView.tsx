import React, { useState, useEffect, useRef } from 'react';

interface JobProgressViewProps {
  jobId: string;
  onComplete: () => void;
  onCancel: () => void;
}

export default function JobProgressView({ jobId, onComplete, onCancel }: JobProgressViewProps): React.ReactElement {
  const [statusMessages, setStatusMessages] = useState<string[]>(['Starting...']);
  const [jobStatus, setJobStatus] = useState<string>('pending');
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Listen for progress push events
    const handler = (data: unknown) => {
      const { status } = data as { jobId: string; status: string };
      setStatusMessages(prev => [...prev.slice(-49), status]); // keep last 50
      if (status === 'Done') {
        setJobStatus('done');
        onComplete();
      } else if (status.startsWith('Error:') || status === 'Cancelled') {
        setJobStatus('failed');
      }
    };
    window.electronAPI.on('transcription:progress', handler);
    return () => window.electronAPI.off('transcription:progress', handler);
  }, [jobId, onComplete]);

  useEffect(() => {
    // Auto-scroll to bottom
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [statusMessages]);

  const handleCancel = async () => {
    await window.electronAPI.invoke('transcription:cancel-job');
    onCancel();
  };

  return (
    <div style={{ color: '#cdd6f4' }}>
      <h2 style={{ marginTop: 0 }}>Transcribing...</h2>
      <div
        ref={listRef}
        style={{
          background: '#313244', borderRadius: 8, padding: 12,
          height: 200, overflowY: 'auto', marginBottom: 16, fontSize: 12,
        }}
        role="log"
        aria-label="Transcription progress"
        aria-live="polite"
      >
        {statusMessages.map((m, i) => (
          <div
            key={i}
            style={{ color: m.startsWith('Error') ? '#f38ba8' : m === 'Done' ? '#a6e3a1' : '#cdd6f4' }}
          >
            {m}
          </div>
        ))}
      </div>
      {/* Indeterminate progress bar */}
      {(jobStatus === 'pending' || jobStatus === 'running') ? (
        <div style={{ background: '#45475a', borderRadius: 4, height: 6, overflow: 'hidden', marginBottom: 16 }}>
          <div style={{
            width: '30%', height: '100%', background: '#cba6f7',
            animation: 'progress-slide 1.5s ease-in-out infinite',
          }} />
        </div>
      ) : null}
      {jobStatus !== 'done' && (
        <button
          onClick={() => void handleCancel()}
          style={{
            background: '#f38ba8', color: '#1e1e2e', border: 'none',
            borderRadius: 4, padding: '8px 20px', cursor: 'pointer',
          }}
        >
          Cancel
        </button>
      )}
    </div>
  );
}
