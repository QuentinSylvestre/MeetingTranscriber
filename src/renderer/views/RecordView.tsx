/**
 * RecordView.tsx — Microphone recording UI.
 *
 * Features:
 *   - Microphone device selector (enumerateDevices)
 *   - Record / Pause / Resume / Stop controls
 *   - Live recording duration display (HH:MM:SS)
 *   - Loopback toggle permanently disabled (naudiodon FAIL, v1)
 *   - Error display
 *
 * Audio path: Phase 4 uses a timestamped temp filename in the browser's
 * standard app data path. Phase 9 will wire up the preferences store
 * (recordingsFolder setting) and replace the hardcoded path.
 */

import React, { useState, useEffect } from 'react';
import { useRecorder } from '../hooks/useRecorder';

interface RecordViewProps {
  /** Called when a recording has been stopped and the MP3 flushed to disk. */
  onJobStopped?: (jobId: string) => void;
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

export default function RecordView({ onJobStopped }: RecordViewProps): React.ReactElement {
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedDevice, setSelectedDevice] = useState<string>('');

  const { status, durationMs, error, start, pause, resume, stop } = useRecorder(
    (jobId) => onJobStopped?.(jobId)
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
    // Re-enumerate when devices change (plug/unplug).
    navigator.mediaDevices.addEventListener('devicechange', enumerate);
    return () => navigator.mediaDevices.removeEventListener('devicechange', enumerate);
  }, []);

  const handleStart = async (): Promise<void> => {
    const jobId = `job-${Date.now()}`;
    // Phase 4: use a timestamped filename in the current working directory.
    // Phase 9 will resolve this via the recordingsFolder preference.
    const audioPath = `recording-${jobId}.mp3`;
    await start(jobId, audioPath, selectedDevice || undefined);
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
    minWidth: 260,
  };

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
          style={selectStyle}
          disabled={status !== 'idle'}
        >
          <option value="">Default microphone</option>
          {devices.map((d) => (
            <option key={d.deviceId} value={d.deviceId}>
              {d.label || `Device ${d.deviceId.substring(0, 8)}`}
            </option>
          ))}
        </select>
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
              animation: 'none',
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
            <button style={btn.stop} onClick={stop}>■ Stop</button>
          </>
        )}

        {status === 'paused' && (
          <>
            <button style={btn.resume} onClick={resume}>▶ Resume</button>
            <button style={btn.stop} onClick={stop}>■ Stop</button>
          </>
        )}

        {status === 'stopping' && (
          <span style={{ color: '#f9e2af', fontSize: 14 }}>Finalizing recording…</span>
        )}
      </div>
    </div>
  );
}
