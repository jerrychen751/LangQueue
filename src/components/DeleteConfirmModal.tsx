import { useEffect, useRef } from 'react'

type DeleteConfirmModalProps = {
  open: boolean
  title?: string
  description?: string
  confirmLabel?: string
  cancelLabel?: string
  onConfirm: () => void
  onCancel: () => void
}

export default function DeleteConfirmModal({
  open,
  title = 'Confirm deletion',
  description = 'This action cannot be undone.',
  confirmLabel = 'Delete',
  cancelLabel = 'Cancel',
  onConfirm,
  onCancel,
}: DeleteConfirmModalProps) {
  const cancelRef = useRef<HTMLButtonElement | null>(null)

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel()
      if (e.key === 'Enter') onConfirm()
    }
    document.addEventListener('keydown', onKey)
    // autofocus cancel for safety
    cancelRef.current?.focus()
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onCancel, onConfirm])

  if (!open) return null

  return (
    <div className="fixed left-0 top-0 z-[100] flex h-[600px] w-popup items-center justify-center">
      <div className="absolute inset-0 bg-[#1c272c]/30 backdrop-blur-sm" onClick={onCancel} />
      <div className="relative z-[101] w-[340px] rounded-[6px] border border-[#bcc7ca] bg-white p-5 text-[#1c272c] shadow-lg">
        <div className="popup-kicker text-rose-700">Confirm action</div>
        <div className="modal-title mt-1">{title}</div>
        <div className="mt-2 text-xs leading-5 text-[#6f7c82]">{description}</div>
        <div className="mt-4 flex items-center justify-end gap-2">
          <button ref={cancelRef} className="secondary-button min-h-10" onClick={onCancel}>
            {cancelLabel}
          </button>
          <button className="inline-flex min-h-10 items-center justify-center rounded-[4px] bg-rose-700 px-4 text-xs font-bold text-white transition hover:bg-rose-600" onClick={onConfirm}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
