import React, { useEffect, useRef } from 'react';

interface Props {
  title: string;
  children?: React.ReactNode;
  onCancel?: () => void;
  cancelLabel?: string;
  /** Whether to show the spinning indicator. Defaults to true so existing callers
   *  (and any future one that never passes this prop) keep today's always-spinning look. */
  spinner?: boolean;
}

const MODAL_TITLE_ID = 'modal-title-heading';

export default function Modal({
  title,
  children,
  onCancel,
  cancelLabel = 'Cancel',
  spinner = true,
}: Props): React.ReactElement {
  const dialogRef = useRef<HTMLDialogElement>(null);

  // Native <dialog> shown via showModal() gets a built-in focus trap, top-layer
  // rendering above the rest of the app, and a ::backdrop pseudo-element — all for
  // free, with no change needed at any call site. Open/close is owned by this
  // component's mount lifecycle, not by the dialog's own default dismiss behavior.
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    dialog.showModal();
    return () => dialog.close();
  }, []);

  const handleDialogCancel = (e: React.SyntheticEvent<HTMLDialogElement>) => {
    // Escape fires the dialog's native 'cancel' event, which would otherwise close
    // the dialog outside React's control (leaving it invisible but still mounted).
    // Suppress that default, and act on Escape only when a cancel action is
    // available — mirroring the visible Cancel button, the modal's only other
    // dismiss path. When no onCancel is passed this is a no-op, keeping the dialog up
    // for a single Escape press; browsers only honor preventDefault() on 'cancel' once
    // per unconsumed user-activation, so a second Escape with no intervening
    // interaction can close the dialog natively despite this handler.
    e.preventDefault();
    onCancel?.();
  };

  return (
    <dialog
      ref={dialogRef}
      className="modal-backdrop"
      aria-labelledby={MODAL_TITLE_ID}
      onCancel={handleDialogCancel}
    >
      <div className="modal-card">
        {spinner && <div className="modal-spinner" aria-hidden="true" />}
        <div className="modal-title" id={MODAL_TITLE_ID}>{title}</div>
        {children}
        {onCancel && (
          <button className="btn btn-ghost" onClick={onCancel}>
            {cancelLabel}
          </button>
        )}
      </div>
    </dialog>
  );
}
