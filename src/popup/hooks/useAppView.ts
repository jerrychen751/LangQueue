import { useState, useEffect } from 'react'

export type AppView = 'main' | 'settings'

export function useAppView() {
  const [view, setView] = useState<AppView>('main')

  useEffect(() => {
    const handler = (message: { type?: string }) => {
      if (message.type === 'DB_CLEARED' || message.type === 'PROMPTS_IMPORTED') {
        setView('main')
      }
    }
    chrome.runtime.onMessage.addListener(handler)
    return () => chrome.runtime.onMessage.removeListener(handler)
  }, [])

  return { view, setView }
}