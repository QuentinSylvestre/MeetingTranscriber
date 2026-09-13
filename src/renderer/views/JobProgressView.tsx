import React, { useState, useEffect, useRef } from 'react';

interface Props {
  jobId: string;
  onComplete: () => void;
  onCancel: () => void;
}

export default function JobProgressView({ jobId, onComplete, onCancel }: Props): React.ReactElement {
  const [lines, setLines] = useState<string[]>(['Starting transcription…']);
  const [done, setDone] = useState(false);
  const [failed, setFailed] = useState(false);
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (data: unknown) => {
      const { status } = data as { jobId: string; status: string };
      setLines(prev => [...prev.slice(-99), status]);
      if (status === 'Done') { setDone(true); setTimeout(onComplete, 800); }
      else if (status.startsWith('Error:') || status === 'Cancelled') setFailed(true);
    };
    window.electronAPI.on('transcription:progress', handler);
    return () => window.electronAPI.off('transcription:progress', handler);
  }, [jobId, onComplete]);

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [lines]);

  const handleCancel = async () => {
    await window.electronAPI.invoke('transcription:cancel-job');
    onCancel();
  };

  return (
    <div>
      <div className="page-header">
        <div className="page-title">Transcribing…</div>
        <div className="page-subtitle">
          {done ? 'Complete' : failed ? 'Failed' : 'Processing your recording'}
        </div>
      </div>

      {/* Progress bar */}
      {!done && !failed && (
        <div className="progress-bar-track" style={{ marginBottom: 'var(--space-4)' }}>
          <div className="progress-bar-fill" />
        </div>
      )}

      {done && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 'var(--space-4)', color: 'var(--success)', fontSize: 14, fontWeight: 600 }}>
          ✓ Transcription complete — opening transcript…
        </div>
      )}

      {/* Log */}
      <div className="progress-log selectable" ref={logRef} aria-live="polite" aria-label="Transcription progress">
        {lines.map((l, i) => (
          <div
            key={i}
            className={`progress-log-line${l.startsWith('Error') ? ' error' : l === 'Done' ? ' done' : ''}`}
          >
            <span style={{ color: 'var(--surface2)', marginRight: 8, userSelect: 'none' }}>›</span>
            {l}
          </div>
        ))}
      </div>

      {/* Cancel */}
      {!done && (
        <div style={{ marginTop: 'var(--space-4)' }}>
          <button className="btn btn-ghost" onClick={handleCancel}>
            Cancel transcription
          </button>
        </div>
      )}
    </div>
  );
}
