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
      <div className="fixed left-1/2 -translate-x-1/2 bottom-3 z-[9999] space-y-2 w-[calc(100%-24px)] max-w-popup">
        {toasts.map((t) => (
          <div
            key={t.id}
            role="status"
            className={`px-3 py-2 rounded-md text-xs shadow border flex items-start gap-2
              ${t.variant === 'success' ? 'bg-emerald-50 border-emerald-200 text-emerald-800 dark:bg-emerald-900/30 dark:border-emerald-800 dark:text-emerald-200' : ''}
              ${t.variant === 'error' ? 'bg-rose-50 border-rose-200 text-rose-800 dark:bg-rose-900/30 dark:border-rose-800 dark:text-rose-200' : ''}
              ${t.variant === 'info' ? 'bg-gray-50 border-gray-200 text-gray-800 dark:bg-gray-800 dark:border-gray-700 dark:text-gray-100' : ''}
            `}
          >
            <div className="flex-1">
              {t.title ? <div className="font-medium mb-0.5">{t.title}</div> : null}
              <div>{t.message}</div>
            </div>
            <button className="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200" onClick={() => removeToast(t.id)} aria-label="Dismiss">
              ×
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}


