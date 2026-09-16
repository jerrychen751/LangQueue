import React from 'react'
import { createRoot } from 'react-dom/client'
import Onboarding from './Onboarding'
import { ToastProvider } from '../components/ToastProvider'
import '../index.css'
import './onboarding.css'

async function bootstrap() {
  if (import.meta.env.DEV && !globalThis.chrome?.runtime?.onMessage) {
    const { installDevChromeMock } = await import('../popup/devChromeMock')
    installDevChromeMock()
  }

  createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <ToastProvider className="fixed bottom-5 left-1/2 z-[9999] w-[420px] -translate-x-1/2 space-y-2">
        <Onboarding />
      </ToastProvider>
    </React.StrictMode>
  )
}

bootstrap()
