import { useEffect, useId, useRef } from 'react';

type DeleteConfirmModalProps = {
  open: boolean;
  title?: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
};

export default function DeleteConfirmModal({
  open,
  title = 'Confirm deletion',
  description = 'This action cannot be undone.',
  confirmLabel = 'Delete',
  cancelLabel = 'Cancel',
  onConfirm,
  onCancel,
  busy = false,
}: DeleteConfirmModalProps) {
  const titleId = useId();
  const descriptionId = useId();
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const callbacksRef = useRef({ onCancel, busy });
  callbacksRef.current = { onCancel, busy };
  const cancelRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!open) {
      return;
    }
    const previous = document.activeElement as HTMLElement | null;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        if (!callbacksRef.current.busy) {
          callbacksRef.current.onCancel();
        }
      }
      if (e.key === 'Tab') {
        const controls = Array.from(dialogRef.current?.querySelectorAll<HTMLButtonElement>('button') || []).filter((control) => !control.disabled);
        const first = controls[0];
        const last = controls[controls.length - 1];
        if (!first || !last) {
          e.preventDefault();
        } else if (e.shiftKey && (document.activeElement === first || !dialogRef.current?.contains(document.activeElement))) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && (document.activeElement === last || !dialogRef.current?.contains(document.activeElement))) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener('keydown', onKey);
    // autofocus cancel for safety
    cancelRef.current?.focus();
    return () => {
      document.removeEventListener('keydown', onKey);
      if (previous?.isConnected) {
        previous.focus();
      }
    };
  }, [open]);

  if (!open) {
    return null;
  }

  return (
    <div className="fixed left-0 top-0 z-[100] flex h-[600px] w-popup items-center justify-center">
      <div className="absolute inset-0 bg-[#1c272c]/30 backdrop-blur-sm" onClick={() => {
        if (!busy) {
          onCancel();
        }
      }} />
      <div ref={dialogRef} role="alertdialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={descriptionId} aria-busy={busy} className="relative z-[101] w-[340px] rounded-[6px] border border-[#bcc7ca] bg-white p-5 text-[#1c272c] shadow-lg">
        <div className="popup-kicker text-rose-700">Confirm action</div>
        <div id={titleId} className="modal-title mt-1">{title}</div>
        <div id={descriptionId} className="mt-2 text-xs leading-5 text-[#6f7c82]">{description}</div>
        <div className="mt-4 flex items-center justify-end gap-2">
          <button type="button" disabled={busy} ref={cancelRef} className="secondary-button min-h-10" onClick={onCancel}>
            {cancelLabel}
          </button>
          <button type="button" disabled={busy} className="inline-flex min-h-10 items-center justify-center rounded-[4px] bg-rose-700 px-4 text-xs font-bold text-white transition hover:bg-rose-600" onClick={onConfirm}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
