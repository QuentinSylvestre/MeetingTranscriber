import React, { useCallback, useRef } from 'react';
import AudioPlayer, { type AudioPlayerRef } from '../components/AudioPlayer';
import SpeakerTurnItem from '../components/SpeakerTurnItem';
import { useTranscript } from '../hooks/useTranscript';
import type { TranscriptTurn } from '../../shared/ipc-types';

interface Props { jobId: string; audioPath: string; }

export default function TranscriptView({ jobId, audioPath }: Props): React.ReactElement {
  const { turns, loading, error, renameSpeaker, getDisplayName } = useTranscript(jobId);
  const audioPlayerRef = useRef<AudioPlayerRef>(null);
  const audioUrl = `app://${audioPath.replace(/\\/g, '/')}`;

  const onSeek = useCallback((ms: number) => audioPlayerRef.current?.seekTo(ms), []);

  if (loading) return <div style={{ color: 'var(--overlay1)', padding: 'var(--space-4)' }}>Loading…</div>;

  const groups = new Map<number, TranscriptTurn[]>();
  for (const t of turns) {
    if (!groups.has(t.chunk_index)) groups.set(t.chunk_index, []);
    groups.get(t.chunk_index)!.push(t);
  }
  const isChunked = groups.size > 1;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-4)', paddingBottom: 'var(--space-4)', borderBottom: '1px solid var(--surface0)' }}>
        <div>
          <div className="page-title">Transcript</div>
          <div className="page-subtitle">
            {turns.length} turn{turns.length !== 1 ? 's' : ''}
            {isChunked ? ` · ${groups.size} chunks` : ''}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
          <button className="btn btn-success btn-sm" onClick={() => void window.electronAPI.invoke('export:to-file', { jobId })}>
            ⇩ Export .txt
          </button>
          <button className="btn btn-ghost btn-sm" onClick={() => void window.electronAPI.invoke('export:to-clipboard', { jobId })}>
            📋 Copy
          </button>
        </div>
      </div>

      {error && <p className="text-error text-sm mb-4">{error}</p>}

      {/* Audio player */}
      <AudioPlayer ref={audioPlayerRef} src={audioUrl} />

      {/* Turns */}
      <div className="transcript-turns">
        {Array.from(groups.entries()).map(([chunkIdx, chunkTurns]) => (
          <React.Fragment key={chunkIdx}>
            {isChunked && (
              <div className="chunk-separator">Chunk {chunkIdx + 1}</div>
            )}
            {chunkTurns.map(turn => (
              <SpeakerTurnItem
                key={turn.id}
                turn={turn}
                displayName={getDisplayName(turn.chunk_index, turn.speaker_label)}
                onRename={name => void renameSpeaker(turn.chunk_index, turn.speaker_label, name)}
                onSeek={onSeek}
              />
            ))}
          </React.Fragment>
        ))}

        {turns.length === 0 && (
          <div style={{ textAlign: 'center', padding: '40px 24px', color: 'var(--overlay0)', fontSize: 13 }}>
            No transcript content — the recording may have been silent
          </div>
        )}
      </div>
    </div>
  );
}
