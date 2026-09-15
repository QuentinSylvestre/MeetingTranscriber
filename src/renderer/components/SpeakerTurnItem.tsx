import React from 'react';
import SpeakerLabel from './SpeakerLabel';
import type { TranscriptTurn } from '../../shared/ipc-types';

function fmt(ms: number): string {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s%60).padStart(2,'0')}`;
}

interface Props {
  turn: TranscriptTurn;
  displayName: string;
  onRename: (name: string) => void;
  onSeek: (ms: number) => void;
}

export default function SpeakerTurnItem({ turn, displayName, onRename, onSeek }: Props): React.ReactElement {
  return (
    <div className="speaker-turn">
      <span
        className="turn-time"
        onClick={() => onSeek(turn.start_ms)}
        role="button"
        tabIndex={0}
        title="Click to seek to this position"
        style={{ cursor: 'pointer' }}
        onKeyDown={e => (e.key === 'Enter' || e.key === ' ') && onSeek(turn.start_ms)}
        aria-label={`Seek to ${fmt(turn.start_ms)}`}
      >
        {fmt(turn.start_ms)}
      </span>
      <SpeakerLabel displayName={displayName} onRename={onRename} onSeek={() => onSeek(turn.start_ms)} />
      <span className="turn-text selectable">{turn.text}</span>
    </div>
  );
}
