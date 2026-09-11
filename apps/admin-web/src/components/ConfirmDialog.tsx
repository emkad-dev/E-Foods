import { useEffect, useId, useRef, type ReactNode } from 'react';

type ConfirmDialogProps = {
  body: ReactNode;
  busy?: boolean;
  busyLabel?: string;
  cancelLabel?: string;
  confirmLabel?: string;
  onCancel: () => void;
  onConfirm: () => void;
  title: string;
};

/**
 * Small modal confirmation built on the native <dialog> element, which gives us
 * the modal focus trap, Escape handling and inert background for free.
 *
 * Render it conditionally: mounting opens it, unmounting closes it.
 *
 * This is a DOM React component for apps/admin-web only — it is deliberately
 * unrelated to the react-native ConfirmDialog primitive in packages/design-system.
 */
export default function ConfirmDialog({
  body,
  busy = false,
  busyLabel = 'Working…',
  cancelLabel = 'Cancel',
  confirmLabel = 'Confirm',
  onCancel,
  onConfirm,
  title,
}: ConfirmDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const bodyId = useId();

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) {
      return;
    }

    if (!dialog.open) {
      dialog.showModal();
    }
    // Land on the non-destructive control, never on the destructive one.
    cancelRef.current?.focus();

    return () => {
      if (dialog.open) {
        dialog.close();
      }
    };
  }, []);

  return (
    <dialog
      aria-describedby={bodyId}
      aria-labelledby={titleId}
      className="confirm-dialog"
      ref={dialogRef}
      onCancel={(event) => {
        // Let React unmount the dialog instead of the browser closing it, so
        // the open state stays owned by the parent.
        event.preventDefault();
        if (!busy) {
          onCancel();
        }
      }}
      onClick={(event) => {
        if (event.target === dialogRef.current && !busy) {
          onCancel();
        }
      }}
    >
      <div className="confirm-dialog-body">
        <h3 className="confirm-dialog-title" id={titleId}>
          {title}
        </h3>
        <div className="confirm-dialog-text" id={bodyId}>
          {body}
        </div>
        <div className="confirm-dialog-actions">
          <button
            type="button"
            className="btn btn-sm confirm-dialog-cancel"
            disabled={busy}
            onClick={onCancel}
            ref={cancelRef}
          >
            {cancelLabel}
          </button>
          <button type="button" className="btn btn-sm confirm-dialog-confirm" disabled={busy} onClick={onConfirm}>
            {busy ? busyLabel : confirmLabel}
          </button>
        </div>
      </div>
    </dialog>
  );
}
