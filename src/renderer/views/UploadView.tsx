import React, { useState, useRef } from 'react';
import { PROVIDER_NAMES, PROVIDER_LABELS } from '../../shared/ipc-types';
import type { ProviderName } from '../../shared/ipc-types';

const ACCEPTED_EXTENSIONS = ['.mp3', '.mp4', '.wav', '.m4a', '.ogg'];

interface UploadFormState {
  file: File | null;
  provider: ProviderName;
  language: 'fr' | 'en' | 'auto';
  title: string;
  error: string | null;
}

interface UploadViewProps {
  onTranscribeStarted?: (jobId: string) => void;
}

export default function UploadView({ onTranscribeStarted }: UploadViewProps): React.ReactElement {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [form, setForm] = useState<UploadFormState>({
    file: null,
    provider: 'assemblyai',
    language: 'auto',
    title: '',
    error: null,
  });
  const [dragOver, setDragOver] = useState(false);

  const validateFile = (file: File): string | null => {
    const ext = '.' + (file.name.split('.').pop() ?? '').toLowerCase();
    if (!ACCEPTED_EXTENSIONS.includes(ext)) {
      return `Unsupported file type. Accepted: ${ACCEPTED_EXTENSIONS.join(', ')}`;
    }
    return null;
  };

  const handleFileSelect = (file: File) => {
    const error = validateFile(file);
    setForm(prev => ({ ...prev, file: error ? null : file, error }));
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFileSelect(file);
  };

  const handleTranscribe = async () => {
    if (!form.file) {
      setForm(prev => ({ ...prev, error: 'Please select an audio file.' }));
      return;
    }
    const jobId = `job-${Date.now()}`;
    onTranscribeStarted?.(jobId);
  };

  const selectStyle: React.CSSProperties = {
    background: '#313244',
    border: '1px solid #45475a',
    color: '#cdd6f4',
    padding: '6px 10px',
    borderRadius: 4,
    fontSize: 13,
  };

  const dropZoneStyle: React.CSSProperties = {
    border: `2px dashed ${dragOver ? '#cba6f7' : '#45475a'}`,
    borderRadius: 8,
    padding: '32px 24px',
    textAlign: 'center',
    background: dragOver ? '#1e1e3e' : '#313244',
    cursor: 'pointer',
    marginBottom: 16,
    color: dragOver ? '#cba6f7' : '#585b70',
    transition: 'border-color 0.1s, background 0.1s',
  };

  return (
    <div style={{ color: '#cdd6f4' }}>
      <h2 style={{ marginTop: 0 }}>Upload</h2>

      {/* Drop zone */}
      <div
        style={dropZoneStyle}
        onClick={() => fileInputRef.current?.click()}
        onDragOver={e => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        role="button"
        tabIndex={0}
        aria-label="Drop audio file here or click to browse"
        onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') fileInputRef.current?.click(); }}
      >
        {form.file ? (
          <span style={{ color: '#a6e3a1' }}>✓ {form.file.name}</span>
        ) : (
          <span>
            Drop audio file here or click to browse
            <br />
            <small style={{ fontSize: 11 }}>{ACCEPTED_EXTENSIONS.join(' ')}</small>
          </span>
        )}
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept={ACCEPTED_EXTENSIONS.join(',')}
        style={{ display: 'none' }}
        onChange={e => e.target.files?.[0] && handleFileSelect(e.target.files[0])}
        aria-label="Select audio file"
      />

      {form.error && (
        <p role="alert" style={{ color: '#f38ba8', fontSize: 13, margin: '0 0 12px' }}>
          {form.error}
        </p>
      )}

      {/* Options */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
        <div>
          <label style={{ display: 'block', fontSize: 13, marginBottom: 4 }}>Provider</label>
          <select
            value={form.provider}
            onChange={e => setForm(prev => ({ ...prev, provider: e.target.value as ProviderName }))}
            style={selectStyle}
            aria-label="Transcription provider"
          >
            {PROVIDER_NAMES.map(p => (
              <option key={p} value={p}>{PROVIDER_LABELS[p]}</option>
            ))}
          </select>
        </div>
        <div>
          <label style={{ display: 'block', fontSize: 13, marginBottom: 4 }}>Language</label>
          <select
            value={form.language}
            onChange={e => setForm(prev => ({ ...prev, language: e.target.value as 'fr' | 'en' | 'auto' }))}
            style={selectStyle}
            aria-label="Language"
          >
            <option value="auto">Auto-detect</option>
            <option value="fr">French</option>
            <option value="en">English</option>
          </select>
        </div>
      </div>

      <div style={{ marginBottom: 16 }}>
        <label style={{ display: 'block', fontSize: 13, marginBottom: 4 }}>
          Title (optional)
        </label>
        <input
          type="text"
          value={form.title}
          onChange={e => setForm(prev => ({ ...prev, title: e.target.value }))}
          placeholder="Meeting title (auto-generated if blank)"
          style={{ ...selectStyle, width: '100%', boxSizing: 'border-box' }}
          aria-label="Job title"
        />
      </div>

      <button
        onClick={handleTranscribe}
        disabled={!form.file}
        style={{
          background: form.file ? '#cba6f7' : '#45475a',
          color: '#1e1e2e',
          border: 'none',
          borderRadius: 4,
          padding: '10px 24px',
          cursor: form.file ? 'pointer' : 'not-allowed',
          fontSize: 14,
          fontWeight: 'bold',
        }}
        aria-disabled={!form.file}
      >
        Transcribe
      </button>
    </div>
  );
}
