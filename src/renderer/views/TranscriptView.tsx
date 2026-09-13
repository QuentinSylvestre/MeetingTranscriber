import React, { useCallback, useRef } from 'react';
import AudioPlayer, { type AudioPlayerRef } from '../components/AudioPlayer';
import SpeakerTurnItem from '../components/SpeakerTurnItem';
import { useTranscript } from '../hooks/useTranscript';
import type { TranscriptTurn } from '../../shared/ipc-types';

interface TranscriptViewProps {
  jobId: string;
  audioPath: string;
}

export default function TranscriptView({ jobId, audioPath }: TranscriptViewProps): React.ReactElement {
  const { turns, loading, error, renameSpeaker, getDisplayName } = useTranscript(jobId);
  const audioPlayerRef = useRef<AudioPlayerRef>(null);

  // Convert absolute Windows path to app:// URL
  const audioUrl = `app://${audioPath.replace(/\\/g, '/')}`;

  const handleExportFile = async () => {
    await window.electronAPI.invoke('export:to-file', { jobId });
  };

  const handleExportClipboard = async () => {
    await window.electronAPI.invoke('export:to-clipboard', { jobId });
  };

  const onSeek = useCallback((ms: number) => {
    audioPlayerRef.current?.seekTo(ms);
  }, []);

  if (loading) return <div style={{ color: '#cdd6f4' }}>Loading transcript...</div>;

  if (error) {
    return <p style={{ color: '#f38ba8' }}>Failed to load transcript: {error}</p>;
  }

  // Group turns by chunk for separator rendering
  const groups: Map<number, TranscriptTurn[]> = new Map();
  for (const t of turns) {
    if (!groups.has(t.chunk_index)) groups.set(t.chunk_index, []);
    groups.get(t.chunk_index)!.push(t);
  }
  const isChunked = groups.size > 1;

  return (
    <div style={{ color: '#cdd6f4' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <h2 style={{ marginTop: 0 }}>Transcript</h2>
        <div>
          <button
            onClick={() => void handleExportFile()}
            style={{
              background: '#a6e3a1', color: '#1e1e2e', border: 'none',
              borderRadius: 4, padding: '6px 14px', cursor: 'pointer', marginRight: 8,
            }}
          >
            Export ⇩
          </button>
          <button
            onClick={() => void handleExportClipboard()}
            style={{
              background: '#89b4fa', color: '#1e1e2e', border: 'none',
              borderRadius: 4, padding: '6px 14px', cursor: 'pointer',
            }}
          >
            Copy 📋
          </button>
        </div>
      </div>

      {/* Audio player using app:// protocol */}
      <AudioPlayer ref={audioPlayerRef} src={audioUrl} />

      {/* Turns grouped by chunk */}
      {Array.from(groups.entries()).map(([chunkIdx, chunkTurns]) => (
        <React.Fragment key={chunkIdx}>
          {isChunked && (
            <div style={{
              color: '#585b70', fontSize: 11, textAlign: 'center',
              padding: '8px 0', borderTop: '1px solid #45475a', margin: '8px 0',
            }}>
              — Chunk {chunkIdx + 1} —
            </div>
          )}
          {chunkTurns.map(turn => (
            <SpeakerTurnItem
              key={turn.id}
              turn={turn}
              displayName={getDisplayName(turn.chunk_index, turn.speaker_label)}
              onRename={(newName) => void renameSpeaker(turn.chunk_index, turn.speaker_label, newName)}
              onSeek={onSeek}
            />
          ))}
        </React.Fragment>
      ))}

      {turns.length === 0 && !loading && (
        <p style={{ color: '#585b70' }}>No transcript content. The recording may have been silent.</p>
      )}
    </div>
  );
}
