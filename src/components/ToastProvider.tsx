import React, { useCallback, useMemo, useRef, useState } from 'react'
import { ToastContext, type ToastContextValue, type ToastVariant } from './toastContext'

type Toast = {
  id: string
  title?: string
  message: string
  variant: ToastVariant
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])
  const timeoutsRef = useRef<Record<string, number>>({})

  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id))
    const handle = timeoutsRef.current[id]
    if (handle) {
      clearTimeout(handle)
      delete timeoutsRef.current[id]
    }
  }, [])

  const showToast = useCallback((opts: { title?: string; message: string; variant?: ToastVariant; durationMs?: number }) => {
    const id = `toast_${Date.now()}_${Math.random().toString(36).slice(2)}`
    const toast: Toast = {
      id,
      title: opts.title,
      message: opts.message,
      variant: opts.variant ?? 'info',
    }
    setToasts((prev) => [...prev, toast])
    const duration = Math.max(1200, opts.durationMs ?? 2400)
    const handle = window.setTimeout(() => removeToast(id), duration)
    timeoutsRef.current[id] = handle
  }, [removeToast])

  const value = useMemo<ToastContextValue>(() => ({ showToast }), [showToast])

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="fixed bottom-3 left-[200px] z-[9999] w-[376px] -translate-x-1/2 space-y-2">
        {toasts.map((t) => (
          <div
            key={t.id}
            role="status"
            className={`flex items-start gap-2 rounded-[4px] border px-3 py-2.5 text-xs shadow-lg
              ${t.variant === 'success' ? 'border-[#b5c9be] bg-[#eef4f0] text-[#3f6954]' : ''}
              ${t.variant === 'error' ? 'border-rose-300 bg-rose-50 text-rose-700' : ''}
              ${t.variant === 'info' ? 'border-[#cfd6d8] bg-white text-[#1c272c]' : ''}
            `}
          >
            <div className="flex-1">
              {t.title ? <div className="font-medium mb-0.5">{t.title}</div> : null}
              <div>{t.message}</div>
            </div>
            <button className="text-[#6f7c82] hover:text-[#1c272c]" onClick={() => removeToast(t.id)} aria-label="Dismiss">
              ×
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}
