import { useState, useEffect } from 'react'
import { checkTabCompatibility, detectActivePlatform } from '../../utils/messaging'

export type Platform = 'chatgpt' | 'gemini' | 'claude' | 'other'

export function useCompatibility() {
  const [compatible, setCompatible] = useState(false)
  const [checking, setChecking] = useState(true)
  const [platform, setPlatform] = useState<Platform>('other')

  useEffect(() => {
    const check = async () => {
      setChecking(true)
      const ok = await checkTabCompatibility()
      setCompatible(ok)
      const p = await detectActivePlatform()
      setPlatform(p === 'chatgpt' || p === 'gemini' || p === 'claude' ? p : 'other')
      setChecking(false)
    }
    check()
  }, [])

  return { compatible, checking, platform }
}