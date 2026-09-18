import React from 'react';

interface Props {
  title: string;
  children?: React.ReactNode;
  onCancel?: () => void;
  cancelLabel?: string;
}

export default function Modal({ title, children, onCancel, cancelLabel }: Props): React.ReactElement {
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label={title}>
      <div className="modal-card">
        <div className="modal-spinner" aria-hidden="true" />
        <div className="modal-title">{title}</div>
        {children}
        {onCancel && (
          <button className="btn btn-ghost" onClick={onCancel}>
            {cancelLabel}
          </button>
        )}
      </div>
    </div>
  );
}
