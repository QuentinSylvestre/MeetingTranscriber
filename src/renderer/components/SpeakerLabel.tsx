import React, { useState, useRef } from 'react';

interface Props {
  displayName: string;
  onRename: (name: string) => void;
  onSeek: () => void;
}

export default function SpeakerLabel({ displayName, onRename, onSeek }: Props): React.ReactElement {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(displayName);
  const inputRef = useRef<HTMLInputElement>(null);

  const startEdit = () => {
    setValue(displayName);
    setEditing(true);
    setTimeout(() => inputRef.current?.focus(), 0);
  };

  const commit = () => {
    setEditing(false);
    const trimmed = value.trim();
    if (trimmed && trimmed !== displayName) onRename(trimmed);
  };

  if (editing) {
    return (
      <input
        ref={inputRef}
        className="speaker-rename-input"
        value={value}
        onChange={e => setValue(e.target.value)}
        onBlur={commit}
        onKeyDown={e => {
          if (e.key === 'Enter') commit();
          if (e.key === 'Escape') setEditing(false);
        }}
        aria-label="Rename speaker"
      />
    );
  }

  return (
    <span
      className="speaker-name"
      onClick={onSeek}
      onDoubleClick={startEdit}
      title="Click to seek · Double-click to rename"
      role="button"
      tabIndex={0}
      onKeyDown={e => (e.key === 'Enter' || e.key === ' ') && startEdit()}
      aria-label={`${displayName} — click to seek, double-click to rename`}
    >
      {displayName}
    </span>
  );
}
