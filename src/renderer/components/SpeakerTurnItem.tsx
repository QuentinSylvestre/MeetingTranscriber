import React from 'react';
import SpeakerLabel from './SpeakerLabel';
import type { TranscriptTurn } from '../../shared/ipc-types';

interface SpeakerTurnItemProps {
  turn: TranscriptTurn;
  displayName: string;
  onRename: (newName: string) => void;
  onSeek: (ms: number) => void;
}

function formatMs(ms: number): string {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

export default function SpeakerTurnItem({ turn, displayName, onRename, onSeek }: SpeakerTurnItemProps): React.ReactElement {
  return (
    <div style={{ display: 'flex', gap: 12, marginBottom: 12, alignItems: 'flex-start' }}>
      <span style={{ color: '#585b70', fontSize: 11, minWidth: 60, paddingTop: 2 }}>
        {formatMs(turn.start_ms)}
      </span>
      <SpeakerLabel
        displayName={displayName}
        onRename={onRename}
        onSeek={() => onSeek(turn.start_ms)}
      />
      <span style={{ flex: 1, color: '#cdd6f4', fontSize: 13 }}>{turn.text}</span>
    </div>
  );
}
