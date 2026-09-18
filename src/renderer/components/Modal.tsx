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
  // Distinguishes "closed because this component is unmounting" (the cleanup below,
  // an intentional close we must never fight) from any other close of the native
  // element. Read by handleDialogClose below.
  const closedByUnmountRef = useRef(false);

  // Native <dialog> shown via showModal() gets a built-in focus trap, top-layer
  // rendering above the rest of the app, and a ::backdrop pseudo-element — all for
  // free, with no change needed at any call site. Open/close is owned by this
  // component's mount lifecycle, not by the dialog's own default dismiss behavior.
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    // Reset on every (re-)run, not just declared at useRef's initializer: React 18
    // StrictMode's dev-only double-invoke (mount -> cleanup -> mount) would otherwise
    // leave this true forever after the first synthetic cleanup, permanently
    // disabling handleDialogClose's reopen guard below for the real, subsequent
    // mount.
    closedByUnmountRef.current = false;
    dialog.showModal();
    return () => {
      closedByUnmountRef.current = true;
      dialog.close();
    };
  }, []);

  const handleDialogCancel = (e: React.SyntheticEvent<HTMLDialogElement>) => {
    // Escape fires the dialog's native 'cancel' event, which would otherwise close
    // the dialog outside React's control (leaving it invisible but still mounted).
    // Suppress that default, and act on Escape only when a cancel action is
    // available — mirroring the visible Cancel button, the modal's only other
    // dismiss path. When no onCancel is passed this is a no-op, keeping the dialog up
    // for a single Escape press; browsers only honor preventDefault() on 'cancel' once
    // per unconsumed user-activation, so a second Escape with no intervening
    // interaction can close the dialog natively despite this handler — handled by
    // handleDialogClose below, which reopens the dialog when that happens.
    e.preventDefault();
    onCancel?.();
  };

  const handleDialogClose = () => {
    // Fires for every way the native element can close: this component's own
    // unmount cleanup above, an onCancel-driven close (handleDialogCancel calling
    // onCancel(), which the caller typically responds to by unmounting this modal —
    // that still lands here as the unmount case above), or — the case this exists
    // for — the browser force-closing the dialog on a second Escape press with no
    // intervening interaction, which handleDialogCancel's preventDefault() cannot
    // stop (see its comment above). When there is no onCancel at all (SC-6's "no
    // cancel button" configuration), the dialog must never be dismissible via
    // Escape, so reopen it immediately unless this is our own intentional unmount
    // close.
    if (closedByUnmountRef.current) return;
    if (onCancel) return; // a real dismiss path exists; let this close stand.
    if (!dialogRef.current?.open) dialogRef.current?.showModal();
  };

  return (
    <dialog
      ref={dialogRef}
      className="modal-backdrop"
      aria-labelledby={MODAL_TITLE_ID}
      onCancel={handleDialogCancel}
      onClose={handleDialogClose}
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
