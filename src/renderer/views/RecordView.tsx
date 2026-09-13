import React, { useState, useEffect } from 'react';
import { useRecorder } from '../hooks/useRecorder';
import { PROVIDER_NAMES, PROVIDER_LABELS } from '../../shared/ipc-types';
import type { ProviderName } from '../../shared/ipc-types';

interface RecordViewProps {
  onJobStarted?: (jobId: string, audioPath: string) => void;
}

function formatDuration(ms: number): string {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}`;
}

export default function RecordView({ onJobStarted }: RecordViewProps): React.ReactElement {
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedDevice, setSelectedDevice] = useState('');
  const [selectedProvider, setSelectedProvider] = useState<ProviderName>('assemblyai');
  const [selectedLanguage, setSelectedLanguage] = useState<'fr'|'en'|'auto'>('auto');
  const [currentJobId, setCurrentJobId] = useState<string | null>(null);

  const { status, durationMs, error, start, pause, resume, stop } = useRecorder((_jobId) => {});

  useEffect(() => {
    const enumerate = () =>
      navigator.mediaDevices.enumerateDevices()
        .then(all => setDevices(all.filter(d => d.kind === 'audioinput')))
        .catch(() => {});
    enumerate();
    navigator.mediaDevices.addEventListener('devicechange', enumerate);
    return () => navigator.mediaDevices.removeEventListener('devicechange', enumerate);
  }, []);

  const handleStart = async () => {
    const jobId = `job-${Date.now()}`;
    setCurrentJobId(jobId);
    await start(jobId, selectedDevice || undefined);
  };

  const handleStop = async () => {
    const { audioPath } = await stop();
    const jobId = currentJobId;
    setCurrentJobId(null);
    if (!jobId || !audioPath) return;
    try {
      await window.electronAPI.invoke('transcription:start-job', {
        jobId,
        title: `Recording ${new Date().toLocaleString()}`,
        audioPath,
        provider: selectedProvider,
        model: 'universal',
        language: selectedLanguage,
      });
      onJobStarted?.(jobId, audioPath);
    } catch (err) {
      console.error('Failed to start transcription job:', err);
    }
  };

  const isIdle = status === 'idle';

  return (
    <div>
      <div className="page-header">
        <div className="page-title">Record meeting</div>
        <div className="page-subtitle">Capture audio from your microphone and transcribe</div>
      </div>

      {/* Timer */}
      <div className="record-timer">
        {formatDuration(durationMs)}
        {status === 'recording' && <div className="record-timer-dot" />}
        {status === 'paused' && (
          <span style={{ fontSize: 16, fontFamily: 'var(--font-sans)', color: 'var(--warning)', letterSpacing: 1 }}>
            PAUSED
          </span>
        )}
      </div>

      {/* Controls */}
      <div className="record-controls mb-6">
        {status === 'idle' && (
          <button className="btn btn-primary btn-lg" onClick={handleStart}>
            ⏺ Start Recording
          </button>
        )}
        {status === 'recording' && <>
          <button className="btn btn-warning" onClick={pause}>⏸ Pause</button>
          <button className="btn btn-danger" onClick={handleStop}>⏹ Stop &amp; Transcribe</button>
        </>}
        {status === 'paused' && <>
          <button className="btn btn-success" onClick={resume}>▶ Resume</button>
          <button className="btn btn-danger" onClick={handleStop}>⏹ Stop &amp; Transcribe</button>
        </>}
        {status === 'stopping' && (
          <span style={{ color: 'var(--warning)', fontSize: 13 }}>Finalizing…</span>
        )}
      </div>

      {error && <p className="text-error text-sm mb-4">{error}</p>}

      {/* Config */}
      <div className="card" style={{ maxWidth: 520 }}>
        <div className="card-body">
          <h3 style={{ marginBottom: 'var(--space-4)' }}>Recording settings</h3>

          <div className="form-group">
            <label className="form-label">Microphone</label>
            <select
              className="form-select"
              value={selectedDevice}
              onChange={e => setSelectedDevice(e.target.value)}
              disabled={!isIdle}
            >
              <option value="">Default microphone</option>
              {devices.map(d => (
                <option key={d.deviceId} value={d.deviceId}>
                  {d.label || `Device ${d.deviceId.substring(0,8)}`}
                </option>
              ))}
            </select>
          </div>

          <div className="grid-2">
            <div className="form-group">
              <label className="form-label">Provider</label>
              <select
                className="form-select"
                value={selectedProvider}
                onChange={e => setSelectedProvider(e.target.value as ProviderName)}
                disabled={!isIdle}
              >
                {PROVIDER_NAMES.map(p => (
                  <option key={p} value={p}>{PROVIDER_LABELS[p]}</option>
                ))}
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">Language</label>
              <select
                className="form-select"
                value={selectedLanguage}
                onChange={e => setSelectedLanguage(e.target.value as 'fr'|'en'|'auto')}
                disabled={!isIdle}
              >
                <option value="auto">Auto-detect</option>
                <option value="fr">French</option>
                <option value="en">English</option>
              </select>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', background: 'var(--crust)', borderRadius: 'var(--radius-sm)', fontSize: 12, color: 'var(--overlay0)' }}>
            <span>🔇</span>
            System audio capture unavailable (naudiodon not available for Electron 36)
          </div>
        </div>
      </div>
    </div>
  );
}
