import React, { useState } from 'react';
import { PROVIDER_NAMES, PROVIDER_LABELS } from '../../shared/ipc-types';
import type { ProviderName } from '../../shared/ipc-types';

const ACCEPTED_EXTENSIONS = ['.mp3', '.mp4', '.wav', '.m4a', '.ogg'];

interface UploadViewProps {
  onJobQueued?: (jobId: string, audioPath: string) => void;
}

interface SelectedFile {
  name: string;
  sizeMb: number;
  srcPath: string; // absolute path — from drag (.path) or native picker dialog
}

export default function UploadView({ onJobQueued }: UploadViewProps): React.ReactElement {
  const [selected, setSelected] = useState<SelectedFile | null>(null);
  const [provider, setProvider] = useState<ProviderName>('assemblyai');
  const [language, setLanguage] = useState<'fr'|'en'|'auto'>('auto');
  const [title, setTitle] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const validateExt = (name: string): boolean => {
    const ext = '.' + (name.split('.').pop() ?? '').toLowerCase();
    return ACCEPTED_EXTENSIONS.includes(ext);
  };

  // Both click and drop open the native OS file picker — File.path is unavailable
  // in sandboxed renderers so we never rely on it.
  const handleClick = async () => {
    const srcPath = await window.electronAPI.invoke('settings:pick-audio-file', {
      extensions: ACCEPTED_EXTENSIONS,
    }) as string | null;
    if (!srcPath) return; // cancelled
    const name = srcPath.split(/[\\/]/).pop() ?? srcPath;
    if (!validateExt(name)) {
      setError(`Unsupported format. Accepted: ${ACCEPTED_EXTENSIONS.join(' ')}`);
      return;
    }
    setError(null);
    setSelected({ name, sizeMb: 0, srcPath }); // size not critical for display
  };

  const handleTranscribe = async () => {
    if (!selected) { setError('Please select an audio file.'); return; }
    setSubmitting(true);
    setError(null);
    try {
      const jobId = `job-${Date.now()}`;
      const destPath = await window.electronAPI.invoke('settings:copy-upload', {
        srcPath: selected.srcPath,
        jobId,
        fileName: selected.name,
      }) as string;

      // Navigate to progress view BEFORE starting the job so JobProgressView
      // is mounted and its transcription:progress listener is registered before
      // the runner fires any events. Yield with setTimeout(0) to let React flush
      // the navigation re-render before the runner sends its first progress event.
      onJobQueued?.(jobId, destPath);
      // Wait for React to flush the navigation re-render and JobProgressView to mount
      // its transcription:progress listener before the runner starts firing events.
      await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));

      // Fire and forget — errors are surfaced via transcription:progress 'Error:' event
      void window.electronAPI.invoke('transcription:start-job', {
        jobId,
        title: title.trim() || selected.name.replace(/\.[^.]+$/, ''),
        audioPath: destPath,
        provider,
        model: 'default',
        language,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setSubmitting(false);
    }
  };

  return (
    <div>
      <div className="page-header">
        <div className="page-title">Upload audio</div>
        <div className="page-subtitle">Transcribe an existing recording</div>
      </div>

      {/* Drop zone — click anywhere to open native file picker.
           Drag-and-drop is visually supported but File.path is unavailable
           in sandboxed renderers (sandbox:true), so both paths use the native dialog. */}
      <div
        className={`drop-zone${dragOver ? ' over' : ''}${selected ? ' has-file' : ''}`}
        onClick={handleClick}
        onDragOver={e => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={e => { e.preventDefault(); setDragOver(false); void handleClick(); }}
        role="button" tabIndex={0}
        aria-label="Click to browse for an audio file"
        onKeyDown={e => (e.key === 'Enter' || e.key === ' ') && void handleClick()}
      >
        {selected ? (
          <>
            <div className="drop-icon">✅</div>
            <div className="drop-text">{selected.name}</div>
            <div className="drop-hint">
              {selected.sizeMb > 0 ? `${selected.sizeMb.toFixed(1)} MB — ` : ''}click to change
            </div>
          </>
        ) : (
          <>
            <div className="drop-icon">🎵</div>
            <div className="drop-text">Click to browse for an audio file</div>
            <div className="drop-hint">{ACCEPTED_EXTENSIONS.join('  ')}</div>
          </>
        )}
      </div>

      {error && <p className="text-error text-sm mb-4" role="alert">{error}</p>}

      {/* Options */}
      <div className="card" style={{ maxWidth: 520, marginBottom: 'var(--space-4)' }}>
        <div className="card-body">
          <h3 style={{ marginBottom: 'var(--space-4)' }}>Transcription settings</h3>

          <div className="grid-2">
            <div className="form-group">
              <label className="form-label">Provider</label>
              <select className="form-select" value={provider} onChange={e => setProvider(e.target.value as ProviderName)}>
                {PROVIDER_NAMES.map(p => <option key={p} value={p}>{PROVIDER_LABELS[p]}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">Language</label>
              <select className="form-select" value={language} onChange={e => setLanguage(e.target.value as 'fr'|'en'|'auto')}>
                <option value="auto">Auto-detect</option>
                <option value="fr">French</option>
                <option value="en">English</option>
              </select>
            </div>
          </div>

          <div className="form-group" style={{ marginBottom: 0 }}>
            <label className="form-label">Title (optional)</label>
            <input
              className="form-input"
              type="text"
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder="Auto-generated if blank"
            />
          </div>
        </div>
      </div>

      <button
        className={`btn btn-primary btn-lg${(!selected || submitting) ? ' btn-disabled' : ''}`}
        onClick={handleTranscribe}
        disabled={!selected || submitting}
      >
        {submitting ? '⏳ Starting…' : '▶ Transcribe'}
      </button>
    </div>
  );
}
