import React, { useState, useRef } from 'react';
import { PROVIDER_NAMES, PROVIDER_LABELS } from '../../shared/ipc-types';
import type { ProviderName } from '../../shared/ipc-types';

const ACCEPTED_EXTENSIONS = ['.mp3', '.mp4', '.wav', '.m4a', '.ogg'];

interface UploadViewProps {
  onJobQueued?: (jobId: string) => void;
}

export default function UploadView({ onJobQueued }: UploadViewProps): React.ReactElement {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [provider, setProvider] = useState<ProviderName>('assemblyai');
  const [language, setLanguage] = useState<'fr'|'en'|'auto'>('auto');
  const [title, setTitle] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);

  const validate = (f: File): string | null => {
    const ext = '.' + (f.name.split('.').pop() ?? '').toLowerCase();
    return ACCEPTED_EXTENSIONS.includes(ext)
      ? null
      : `Unsupported format. Accepted: ${ACCEPTED_EXTENSIONS.join(' ')}`;
  };

  const handleSelect = (f: File) => {
    const err = validate(f);
    if (err) { setError(err); setFile(null); }
    else { setError(null); setFile(f); }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault(); setDragOver(false);
    const f = e.dataTransfer.files[0];
    if (f) handleSelect(f);
  };

  const handleTranscribe = () => {
    if (!file) { setError('Please select an audio file.'); return; }
    onJobQueued?.(`job-${Date.now()}`);
  };

  return (
    <div>
      <div className="page-header">
        <div className="page-title">Upload audio</div>
        <div className="page-subtitle">Transcribe an existing recording</div>
      </div>

      {/* Drop zone */}
      <div
        className={`drop-zone${dragOver ? ' over' : ''}${file ? ' has-file' : ''}`}
        onClick={() => fileInputRef.current?.click()}
        onDragOver={e => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        role="button" tabIndex={0}
        aria-label="Drop audio file here or click to browse"
        onKeyDown={e => (e.key === 'Enter' || e.key === ' ') && fileInputRef.current?.click()}
      >
        {file ? (
          <>
            <div className="drop-icon">✅</div>
            <div className="drop-text">{file.name}</div>
            <div className="drop-hint">
              {(file.size / 1024 / 1024).toFixed(1)} MB — click to change
            </div>
          </>
        ) : (
          <>
            <div className="drop-icon">🎵</div>
            <div className="drop-text">Drop audio file here or click to browse</div>
            <div className="drop-hint">{ACCEPTED_EXTENSIONS.join('  ')}</div>
          </>
        )}
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept={ACCEPTED_EXTENSIONS.join(',')}
        style={{ display: 'none' }}
        onChange={e => e.target.files?.[0] && handleSelect(e.target.files[0])}
      />

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
        className={`btn btn-primary btn-lg${!file ? ' btn-disabled' : ''}`}
        onClick={handleTranscribe}
        disabled={!file}
      >
        ▶ Transcribe
      </button>
    </div>
  );
}
