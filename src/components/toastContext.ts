import { createContext } from 'react'

export type ToastVariant = 'success' | 'error' | 'info'

export type ToastContextValue = {
  showToast: (opts: { title?: string; message: string; variant?: ToastVariant; durationMs?: number }) => void
}

export const ToastContext = createContext<ToastContextValue | undefined>(undefined)


