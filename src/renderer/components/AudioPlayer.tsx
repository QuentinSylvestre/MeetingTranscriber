import React, { forwardRef, useImperativeHandle } from 'react';
import { useAudioPlayer } from '../hooks/useAudioPlayer';

export interface AudioPlayerRef {
  seekTo: (ms: number) => void;
}

function fmt(ms: number): string {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s%60).padStart(2,'0')}`;
}

const AudioPlayer = forwardRef<AudioPlayerRef, { src: string }>(
  function AudioPlayer({ src }, ref) {
    const { audioRef, playing, currentTimeMs, duration, playbackRate,
      seekTo, togglePlay, setPlaybackRate,
      onTimeUpdate, onDurationChange, onPlay, onPause, onError,
      onLoadStart, onLoadedMetadata, onStalled, onSuspend } = useAudioPlayer();

    useImperativeHandle(ref, () => ({
      seekTo: (ms) => { seekTo(ms); audioRef.current?.play(); },
    }));

    const pct = duration > 0 ? (currentTimeMs / duration) * 100 : 0;

    return (
      <div className="audio-player-bar">
        <audio ref={audioRef} src={src}
          onTimeUpdate={onTimeUpdate} onDurationChange={onDurationChange}
          onPlay={onPlay} onPause={onPause} onError={onError}
          onLoadStart={onLoadStart} onLoadedMetadata={onLoadedMetadata}
          onStalled={onStalled} onSuspend={onSuspend}
          preload="metadata" />

        <button
          className="btn btn-ghost btn-icon"
          onClick={togglePlay}
          aria-label={playing ? 'Pause' : 'Play'}
          style={{ fontSize: 16, minWidth: 36 }}
        >
          {playing ? '⏸' : '▶'}
        </button>

        <input
          type="range" min={0} max={duration} value={currentTimeMs}
          onChange={e => seekTo(Number(e.target.value))}
          className="audio-seek-range"
          aria-label="Seek position"
        />

        <span style={{ fontSize: 12, color: 'var(--overlay1)', fontFamily: 'var(--font-mono)', minWidth: 100, textAlign: 'right' }}>
          {fmt(currentTimeMs)} / {fmt(duration)}
        </span>

        <select
          value={playbackRate}
          onChange={e => setPlaybackRate(Number(e.target.value))}
          className="form-select"
          style={{ width: 60, padding: '4px 6px', fontSize: 12 }}
          aria-label="Playback speed"
        >
          {[0.75, 1, 1.5, 2].map(r => <option key={r} value={r}>{r}×</option>)}
        </select>
      </div>
    );
  }
);

export default AudioPlayer;
