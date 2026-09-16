import React, { useEffect, useRef, useState } from 'react';
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
  onEditText: (id: string, text: string) => void;
}

export default function SpeakerTurnItem({ turn, displayName, onRename, onSeek, onEditText }: Props): React.ReactElement {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(turn.text);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const focusTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Sync draft when turn.text changes externally (e.g. after reset); also close edit mode
  useEffect(() => {
    setDraft(turn.text);
    setEditing(false);
  }, [turn.text]);

  // Cleanup focus timer on unmount
  useEffect(() => {
    return () => {
      if (focusTimerRef.current !== null) clearTimeout(focusTimerRef.current);
    };
  }, []);

  // Auto-size textarea
  useEffect(() => {
    if (editing && textareaRef.current) {
      const el = textareaRef.current;
      el.style.height = 'auto';
      el.style.height = `${el.scrollHeight}px`;
    }
  }, [editing, draft]);

  const startEdit = () => {
    setDraft(turn.text);
    setEditing(true);
    focusTimerRef.current = setTimeout(() => textareaRef.current?.focus(), 0);
  };

  const commitEdit = () => {
    setEditing(false);
    const trimmed = draft.trim();
    if (!trimmed) {
      // Blank on blur: restore to last committed text; do not save empty
      setDraft(turn.text);
      return;
    }
    if (trimmed !== turn.text.trim()) onEditText(turn.id, trimmed);
  };

  const isEdited = turn.text !== turn.original_text;

  return (
    <div className={`speaker-turn${isEdited ? ' speaker-turn--edited' : ''}`}>
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
      {editing ? (
        <textarea
          ref={textareaRef}
          className="turn-text-editor"
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onBlur={commitEdit}
          onKeyDown={e => {
            if (e.key === 'Escape') {
              setEditing(false);
              setDraft(turn.text);
            }
          }}
          aria-label="Edit turn text"
        />
      ) : (
        <span
          className="turn-text selectable"
          onDoubleClick={startEdit}
          role="button"
          tabIndex={0}
          onKeyDown={e => (e.key === 'Enter' || e.key === ' ') && startEdit()}
          aria-label="Edit this turn text"
          title="Double-click to edit"
        >
          {turn.text}
        </span>
      )}
    </div>
  );
}
