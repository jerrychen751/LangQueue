import React from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { ToastProvider } from '../components/ToastProvider'
import '../index.css'

async function bootstrap() {
  if (import.meta.env.DEV && !globalThis.chrome?.runtime?.onMessage) {
    const { installDevChromeMock } = await import('./devChromeMock')
    installDevChromeMock()
  }

  const container = document.getElementById('root')!
  const root = createRoot(container)
  root.render(
    <React.StrictMode>
      <ToastProvider>
        <App />
      </ToastProvider>
    </React.StrictMode>
  )
  // Hide the HTML preloader once React mounts
  const el = document.getElementById('preloader')
  if (el) el.classList.add('hidden')
}

bootstrap()
