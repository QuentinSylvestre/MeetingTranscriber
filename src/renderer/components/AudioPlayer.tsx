import React from 'react';
import { useAudioPlayer } from '../hooks/useAudioPlayer';

interface AudioPlayerProps {
  src: string; // app:// URL
}

function formatMs(ms: number): string {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

export default function AudioPlayer({ src }: AudioPlayerProps): React.ReactElement {
  const {
    audioRef, playing, currentTimeMs, duration, playbackRate,
    seekTo, togglePlay, setPlaybackRate,
    onTimeUpdate, onDurationChange, onPlay, onPause,
  } = useAudioPlayer();

  const btnStyle: React.CSSProperties = {
    background: '#45475a', border: 'none', color: '#cdd6f4', padding: '4px 10px',
    borderRadius: 4, cursor: 'pointer', fontSize: 13,
  };

  return (
    <div style={{ background: '#313244', borderRadius: 8, padding: '12px 16px', marginBottom: 16 }}>
      {/* Hidden native audio element for range request support */}
      <audio
        ref={audioRef}
        src={src}
        onTimeUpdate={onTimeUpdate}
        onDurationChange={onDurationChange}
        onPlay={onPlay}
        onPause={onPause}
        preload="metadata"
        aria-label="Recording audio player"
      />
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <button onClick={togglePlay} style={btnStyle} aria-label={playing ? 'Pause' : 'Play'}>
          {playing ? '⏸' : '▶'}
        </button>
        <input
          type="range"
          min={0}
          max={duration}
          value={currentTimeMs}
          onChange={e => seekTo(Number(e.target.value))}
          style={{ flex: 1 }}
          aria-label="Seek"
        />
        <span style={{ fontSize: 12, color: '#585b70', minWidth: 120 }}>
          {formatMs(currentTimeMs)} / {formatMs(duration)}
        </span>
        <select
          value={playbackRate}
          onChange={e => setPlaybackRate(Number(e.target.value))}
          style={{
            background: '#1e1e2e', border: '1px solid #45475a', color: '#cdd6f4',
            fontSize: 12, padding: '2px 6px', borderRadius: 4,
          }}
          aria-label="Playback speed"
        >
          {[0.75, 1, 1.5, 2].map(r => <option key={r} value={r}>{r}x</option>)}
        </select>
      </div>
    </div>
  );
}
