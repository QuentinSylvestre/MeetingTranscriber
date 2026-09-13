import React, { useState, useRef } from 'react';

interface SpeakerLabelProps {
  displayName: string;
  onRename: (newName: string) => void;
  onSeek: () => void;
}

export default function SpeakerLabel({ displayName, onRename, onSeek }: SpeakerLabelProps): React.ReactElement {
  const [editing, setEditing] = useState(false);
  const [inputValue, setInputValue] = useState(displayName);
  const inputRef = useRef<HTMLInputElement>(null);

  const startEdit = () => {
    setInputValue(displayName);
    setEditing(true);
    setTimeout(() => inputRef.current?.focus(), 0);
  };

  const commitEdit = () => {
    setEditing(false);
    const trimmed = inputValue.trim();
    if (trimmed && trimmed !== displayName) onRename(trimmed);
  };

  if (editing) {
    return (
      <input
        ref={inputRef}
        value={inputValue}
        onChange={e => setInputValue(e.target.value)}
        onBlur={commitEdit}
        onKeyDown={e => {
          if (e.key === 'Enter') commitEdit();
          if (e.key === 'Escape') setEditing(false);
        }}
        style={{
          background: '#1e1e2e', border: '1px solid #cba6f7', color: '#cdd6f4',
          fontSize: 13, padding: '2px 6px', borderRadius: 4, fontWeight: 'bold',
        }}
        aria-label="Rename speaker"
      />
    );
  }

  return (
    <span
      onClick={onSeek}
      onDoubleClick={startEdit}
      style={{ fontWeight: 'bold', color: '#89b4fa', cursor: 'pointer', fontSize: 13 }}
      title="Click to seek, double-click to rename"
      role="button"
      tabIndex={0}
      onKeyDown={e => { if (e.key === 'Enter') startEdit(); }}
      aria-label={`Speaker: ${displayName}. Click to seek audio.`}
    >
      {displayName}
    </span>
  );
}
