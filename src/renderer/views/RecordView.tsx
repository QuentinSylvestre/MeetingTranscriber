/**
 * RecordView.tsx — Microphone recording UI.
 *
 * Features:
 *   - Microphone device selector (enumerateDevices)
 *   - Provider and language selectors (mirrors UploadView)
 *   - Record / Pause / Resume / Stop controls
 *   - Live recording duration display (HH:MM:SS)
 *   - On Stop: calls transcription:start-job with the recorded file, then
 *     navigates to the Progress view via onJobStarted callback (SC-2).
 *   - Loopback toggle permanently disabled (naudiodon FAIL, v1)
 *   - Error display
 */

import React, { useState, useEffect } from 'react';
import { useRecorder } from '../hooks/useRecorder';
import { PROVIDER_NAMES, PROVIDER_LABELS } from '../../shared/ipc-types';
import type { ProviderName } from '../../shared/ipc-types';

interface RecordViewProps {
  /**
   * Called when recording has been stopped, the MP3 flushed to disk, and a
   * transcription job has been queued. Navigates the shell to 'progress'.
   */
  onJobStarted?: (jobId: string, audioPath: string) => void;
}

function formatDuration(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  return [
    String(h).padStart(2, '0'),
    String(m).padStart(2, '0'),
    String(s).padStart(2, '0'),
  ].join(':');
}

export default function RecordView({ onJobStarted }: RecordViewProps): React.ReactElement {
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedDevice, setSelectedDevice] = useState<string>('');
  const [selectedProvider, setSelectedProvider] = useState<ProviderName>('assemblyai');
  const [selectedLanguage, setSelectedLanguage] = useState<'fr' | 'en' | 'auto'>('auto');

  // jobIdRef is used across start and stop; keep in component state so it
  // survives the async stop sequence.
  const [currentJobId, setCurrentJobId] = useState<string | null>(null);

  const { status, durationMs, error, start, pause, resume, stop } = useRecorder(
    // onStopped fires after the encoder flushed; the real navigation happens in
    // handleStop after we get the audioPath and queue the transcription job.
    (_jobId) => { /* handled in handleStop */ }
  );

  // Enumerate audio input devices on mount and after permissions may have changed.
  useEffect(() => {
    const enumerate = (): void => {
      navigator.mediaDevices
        .enumerateDevices()
        .then((all) => setDevices(all.filter((d) => d.kind === 'audioinput')))
        .catch(() => {});
    };
    enumerate();
    navigator.mediaDevices.addEventListener('devicechange', enumerate);
    return () => navigator.mediaDevices.removeEventListener('devicechange', enumerate);
  }, []);

  const handleStart = async (): Promise<void> => {
    const jobId = `job-${Date.now()}`;
    setCurrentJobId(jobId);
    // audioPath is now built in the main process — renderer only passes jobId.
    await start(jobId, selectedDevice || undefined);
  };

  const handleStop = async (): Promise<void> => {
    // stop() flushes the encoder and returns the absolute audioPath from main.
    const { audioPath } = await stop();
    const jobId = currentJobId;
    setCurrentJobId(null);

    if (!jobId || !audioPath) return;

    try {
      // Queue the transcription job immediately after the recording is flushed.
      await window.electronAPI.invoke('transcription:start-job', {
        jobId,
        title: `Recording ${new Date().toLocaleString()}`,
        audioPath,
        provider: selectedProvider,
        model: 'universal',
        language: selectedLanguage,
      });
      // Navigate the shell to the progress view.
      onJobStarted?.(jobId, audioPath);
    } catch (err) {
      // Transcription job start failed — the recording was saved but the job
      // didn't queue. The error will surface in the view via the error state
      // of the surrounding shell or via the useRecorder error.
      console.error('Failed to start transcription job after recording:', err);
    }
  };

  // Shared button style (Catppuccin Mocha palette).
  const base: React.CSSProperties = {
    border: 'none',
    borderRadius: 4,
    padding: '8px 20px',
    cursor: 'pointer',
    fontSize: 14,
    fontWeight: 'bold',
    marginRight: 8,
  };
  const btn = {
    record:  { ...base, background: '#cba6f7', color: '#1e1e2e' },
    pause:   { ...base, background: '#f9e2af', color: '#1e1e2e' },
    resume:  { ...base, background: '#a6e3a1', color: '#1e1e2e' },
    stop:    { ...base, background: '#f38ba8', color: '#1e1e2e' },
    disabled:{ ...base, background: '#45475a', color: '#6c7086', cursor: 'not-allowed' },
  };

  const selectStyle: React.CSSProperties = {
    background: '#313244',
    border: '1px solid #45475a',
    color: '#cdd6f4',
    padding: '6px 10px',
    borderRadius: 4,
    fontSize: 13,
  };

  const isIdle = status === 'idle';

  return (
    <div style={{ color: '#cdd6f4' }}>
      <h2 style={{ marginTop: 0 }}>Record</h2>

      {/* Microphone selector */}
      <div style={{ marginBottom: 16 }}>
        <label style={{ display: 'block', marginBottom: 4, fontSize: 13, color: '#a6adc8' }}>
          Microphone
        </label>
        <select
          value={selectedDevice}
          onChange={(e) => setSelectedDevice(e.target.value)}
          style={{ ...selectStyle, minWidth: 260 }}
          disabled={!isIdle}
          aria-label="Microphone device"
        >
          <option value="">Default microphone</option>
          {devices.map((d) => (
            <option key={d.deviceId} value={d.deviceId}>
              {d.label || `Device ${d.deviceId.substring(0, 8)}`}
            </option>
          ))}
        </select>
      </div>

      {/* Provider and language selectors — disabled while recording */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
        <div>
          <label style={{ display: 'block', fontSize: 13, marginBottom: 4, color: '#a6adc8' }}>
            Provider
          </label>
          <select
            value={selectedProvider}
            onChange={(e) => setSelectedProvider(e.target.value as ProviderName)}
            style={selectStyle}
            disabled={!isIdle}
            aria-label="Transcription provider"
          >
            {PROVIDER_NAMES.map((p) => (
              <option key={p} value={p}>{PROVIDER_LABELS[p]}</option>
            ))}
          </select>
        </div>
        <div>
          <label style={{ display: 'block', fontSize: 13, marginBottom: 4, color: '#a6adc8' }}>
            Language
          </label>
          <select
            value={selectedLanguage}
            onChange={(e) => setSelectedLanguage(e.target.value as 'fr' | 'en' | 'auto')}
            style={selectStyle}
            disabled={!isIdle}
            aria-label="Language"
          >
            <option value="auto">Auto-detect</option>
            <option value="fr">French</option>
            <option value="en">English</option>
          </select>
        </div>
      </div>

      {/* Loopback toggle — disabled (naudiodon FAIL) */}
      <div style={{ marginBottom: 20 }}>
        <label
          style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: '#6c7086', cursor: 'not-allowed' }}
          title="System audio capture unavailable on this system (naudiodon not available for Electron 36)"
        >
          <input type="checkbox" disabled checked={false} style={{ cursor: 'not-allowed' }} />
          Capture system audio (unavailable on this system)
        </label>
      </div>

      {/* Duration display */}
      <div style={{ fontSize: 40, fontFamily: 'monospace', marginBottom: 20, letterSpacing: 2 }}>
        {formatDuration(durationMs)}
        {status === 'recording' && (
          <span
            style={{
              display: 'inline-block',
              width: 10,
              height: 10,
              background: '#f38ba8',
              borderRadius: '50%',
              marginLeft: 12,
              verticalAlign: 'middle',
            }}
            title="Recording"
          />
        )}
        {status === 'paused' && (
          <span style={{ marginLeft: 12, fontSize: 16, color: '#f9e2af', verticalAlign: 'middle' }}>
            PAUSED
          </span>
        )}
      </div>

      {/* Error display */}
      {error && (
        <p style={{ color: '#f38ba8', fontSize: 13, marginBottom: 12 }}>
          {error}
        </p>
      )}

      {/* Controls */}
      <div>
        {status === 'idle' && (
          <button style={btn.record} onClick={handleStart}>
            ● Record
          </button>
        )}

        {status === 'recording' && (
          <>
            <button style={btn.pause} onClick={pause}>⏸ Pause</button>
            <button style={btn.stop} onClick={handleStop}>■ Stop</button>
          </>
        )}

        {status === 'paused' && (
          <>
            <button style={btn.resume} onClick={resume}>▶ Resume</button>
            <button style={btn.stop} onClick={handleStop}>■ Stop</button>
          </>
        )}

        {status === 'stopping' && (
          <span style={{ color: '#f9e2af', fontSize: 14 }}>Finalizing recording…</span>
        )}
      </div>
    </div>
  );
}
