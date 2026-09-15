import React, { useCallback, useEffect, useRef, useState } from 'react';
import AudioPlayer, { type AudioPlayerRef } from '../components/AudioPlayer';
import SpeakerTurnItem from '../components/SpeakerTurnItem';
import { useTranscript } from '../hooks/useTranscript';
import type { Job, TranscriptTurn } from '../../shared/ipc-types';

interface Props { jobId: string; audioPath: string; }

export default function TranscriptView({ jobId, audioPath }: Props): React.ReactElement {
  const { turns, loading, error, renameSpeaker, getDisplayName } = useTranscript(jobId);
  const audioPlayerRef = useRef<AudioPlayerRef>(null);

  // Job title state and inline editing
  const [jobTitle, setJobTitle] = useState<string>('');
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState('');
  const titleInputRef = useRef<HTMLInputElement>(null);

  // Load job title on mount
  useEffect(() => {
    if (!jobId) return;
    let alive = true;
    (window.electronAPI.invoke('db:get-job', { id: jobId }) as Promise<Job | null>)
      .then(job => { if (alive && job) setJobTitle(job.title); })
      .catch(console.error);
    return () => { alive = false; };
  }, [jobId]);

  const startTitleEdit = () => {
    setTitleDraft(jobTitle);
    setEditingTitle(true);
    setTimeout(() => titleInputRef.current?.focus(), 0);
  };
  const commitTitleEdit = async () => {
    setEditingTitle(false);
    const trimmed = titleDraft.trim();
    if (trimmed && trimmed !== jobTitle) {
      try {
        await window.electronAPI.invoke('db:update-job-title', { id: jobId, title: trimmed });
        setJobTitle(trimmed);
      } catch {
        console.error('Failed to save title');
      }
    }
  };
  // Build the app:// URL for the audio file.
  // Use three slashes (app:///path) so the URL parser treats the path as the
  // pathname rather than interpreting a Windows drive letter (C:) as a hostname.
  // The protocol handler strips the leading / from /C:/... on Windows.
  const forwardPath = audioPath.replace(/\\/g, '/');
  const audioUrl = forwardPath.startsWith('/')
    ? `app://${forwardPath}`          // already has leading slash (Unix)
    : `app:///${forwardPath}`;        // add leading slash (Windows: C:/...)

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
          {editingTitle ? (
            <input
              ref={titleInputRef}
              className="form-input"
              value={titleDraft}
              onChange={e => setTitleDraft(e.target.value)}
              onBlur={() => void commitTitleEdit()}
              onKeyDown={e => {
                if (e.key === 'Enter') void commitTitleEdit();
                if (e.key === 'Escape') setEditingTitle(false);
              }}
              aria-label="Edit transcript title"
              style={{ fontSize: 'var(--text-lg)', fontWeight: 600, maxWidth: 400 }}
            />
          ) : (
            <div
              className="page-title"
              onDoubleClick={startTitleEdit}
              title="Double-click to rename"
              style={{ cursor: 'text' }}
              role="button"
              tabIndex={0}
              onKeyDown={e => (e.key === 'Enter' || e.key === ' ') && startTitleEdit()}
              aria-label={`${jobTitle || 'Transcript'} — double-click to rename`}
            >
              {jobTitle || 'Transcript'}
            </div>
          )}
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
      {process.env.NODE_ENV === 'development' && (
        <div style={{ fontSize: 10, color: 'var(--overlay0)', marginBottom: 4, wordBreak: 'break-all' }}>
          audio src: {audioUrl}
        </div>
      )}

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
