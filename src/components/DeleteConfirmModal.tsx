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
    <div className="fixed inset-0 z-[100] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" onClick={onCancel} />
      <div className="relative z-[101] w-[340px] rounded-lg border bg-white text-gray-900 p-4 shadow-xl dark:bg-gray-900 dark:text-gray-100 dark:border-gray-700">
        <div className="text-sm font-medium">{title}</div>
        <div className="text-xs text-gray-600 dark:text-gray-300 mt-1">{description}</div>
        <div className="mt-4 flex items-center justify-end gap-2">
          <button ref={cancelRef} className="px-3 py-1.5 text-sm rounded-md border hover:bg-gray-50 dark:hover:bg-gray-800" onClick={onCancel}>
            {cancelLabel}
          </button>
          <button className="px-3 py-1.5 text-sm rounded-md bg-rose-600 text-white hover:bg-rose-700" onClick={onConfirm}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}


