import { useEffect, useRef, useState } from 'react'
import { ArrowLeft, Keyboard } from 'lucide-react'
import type { AppSettings } from '../types'
import { getSettings, saveSettings } from '../utils/storage'
import { useToast } from '../components/useToast'


type SettingsProps = {
  onBack: () => void
}

export default function Settings({ onBack }: SettingsProps) {
  const [settings, setSettings] = useState<AppSettings>({})
  const [status, setStatus] = useState<string | null>(null)
  // Toasts not used now that storage controls are removed
  useToast()
  const autosaveTimerRef = useRef<number | null>(null)
  const didHydrateRef = useRef(false)

  useEffect(() => {
    const load = async () => {
      const existing = await getSettings('local')
      // Prefill shortcut defaults by platform if not already set
      const isMac = /Mac|iPhone|iPad|iPod/.test(navigator.platform)
      const defaults = {
        openLibrary: isMac ? 'Command+Shift+P' : 'Ctrl+Shift+P',
        focusSearch: isMac ? 'Command+Shift+O' : 'Ctrl+Shift+O',
        createPrompt: isMac ? 'Command+Shift+L' : 'Ctrl+Shift+L',
      }
      const merged: AppSettings = {
        ...existing,
        shortcuts: {
          openLibrary: existing.shortcuts?.openLibrary ?? defaults.openLibrary,
          focusSearch: existing.shortcuts?.focusSearch ?? defaults.focusSearch,
          createPrompt: existing.shortcuts?.createPrompt ?? defaults.createPrompt,
        },
      }
      setSettings(merged)
    }
    load()
  }, [])

  // Debounced autosave on settings change (skip first hydration)
  useEffect(() => {
    if (!didHydrateRef.current) {
      didHydrateRef.current = true
      return
    }
    if (autosaveTimerRef.current) window.clearTimeout(autosaveTimerRef.current)
    autosaveTimerRef.current = window.setTimeout(async () => {
      try {
        await saveSettings(settings, 'local')
        setStatus('Saved')
        window.setTimeout(() => setStatus(null), 1200)
      } catch {
        setStatus('Failed to save')
      }
    }, 400)
    return () => {
      if (autosaveTimerRef.current) window.clearTimeout(autosaveTimerRef.current)
    }
  }, [settings])

  // Removed storage import/export helpers and UI

  // Shortcuts are read-only in the UI; changes are not allowed via form

  async function saveAll() {
    await saveSettings(settings, 'local')
    setStatus('Settings saved')
  }

  function formatShortcut(k: string): string {
    if (!k) return ''
    const map: Record<string, string> = {
      Command: 'Cmd',
      Cmd: 'Cmd',
      Control: 'Ctrl',
      Ctrl: 'Ctrl',
      Alt: 'Alt',
      Option: 'Opt',
      Shift: 'Shift',
      Meta: 'Cmd',
    }
    return k
      .split('+')
      .map((part) => map[part.trim()] ?? part.trim())
      .join(' + ')
  }

  return (
    <div className="w-popup min-w-popup max-w-popup h-[600px] bg-white text-gray-900 dark:bg-gray-900 dark:text-gray-100 flex flex-col">
      <header className="border-b">
        <div className="flex items-center gap-2 p-3">
          <button className="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-800" onClick={onBack} aria-label="Back">
            <ArrowLeft size={16} />
          </button>
          <div className="font-medium">Settings</div>
        </div>
      </header>

      <main className="flex-1 overflow-auto p-3 space-y-4 text-sm">
        {status ? (
          <div className="text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded px-2 py-1 dark:text-emerald-200 dark:bg-emerald-900/30 dark:border-emerald-800" role="status">
            {status}
          </div>
        ) : null}

        <section className="space-y-2">
          <div className="font-medium flex items-center gap-2"><Keyboard size={14} /> Keyboard shortcuts</div>
          <div className="grid gap-2">
            <div className="flex items-center gap-2">
              <span className="w-36 text-gray-600 dark:text-gray-300">Open library</span>
              <span className="inline-flex items-center text-xs px-2 py-1 rounded-md bg-white/5 border border-white/10 backdrop-blur-sm">
                {formatShortcut(settings.shortcuts?.openLibrary ?? '')}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <span className="w-36 text-gray-600 dark:text-gray-300">Focus search</span>
              <span className="inline-flex items-center text-xs px-2 py-1 rounded-md bg-white/5 border border-white/10 backdrop-blur-sm">
                {formatShortcut(settings.shortcuts?.focusSearch ?? '')}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <span className="w-36 text-gray-600 dark:text-gray-300">Create prompt</span>
              <span className="inline-flex items-center text-xs px-2 py-1 rounded-md bg-white/5 border border-white/10 backdrop-blur-sm">
                {formatShortcut(settings.shortcuts?.createPrompt ?? '')}
              </span>
            </div>
          </div>
        </section>

        <section className="space-y-2">
          <div className="font-medium">Chain execution defaults</div>
          <label className="inline-flex items-center gap-2 text-sm px-2 py-1 rounded-md bg-white/5 border border-white/10 backdrop-blur-sm">
            <input
              type="checkbox"
              className="h-4 w-4 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 accent-amber-500"
              checked={(settings.chainDefaults?.autoSend ?? true)}
              onChange={(e) => setSettings((prev) => ({
                ...prev,
                chainDefaults: { ...prev.chainDefaults, autoSend: e.target.checked },
              }))}
            />
            Auto-send each prompt in chain
          </label>
          <label className="inline-flex items-center gap-2 text-sm px-2 py-1 rounded-md bg-white/5 border border-white/10 backdrop-blur-sm">
            <input
              type="checkbox"
              className="h-4 w-4 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 accent-amber-500"
              checked={(settings.chainDefaults?.awaitResponse ?? true)}
              onChange={(e) => setSettings((prev) => ({
                ...prev,
                chainDefaults: { ...prev.chainDefaults, awaitResponse: e.target.checked },
              }))}
            />
            Wait for response before next prompt
          </label>
          <label className="inline-flex items-center gap-2 text-sm px-2 py-1 rounded-md bg-white/5 border border-white/10 backdrop-blur-sm">
            <span>Delay between prompts (ms)</span>
            <input
              type="number"
              min={0}
              max={30000}
              value={(settings.chainDefaults?.defaultDelayMs ?? 1000)}
              onChange={(e) => setSettings((prev) => ({
                ...prev,
                chainDefaults: { ...prev.chainDefaults, defaultDelayMs: Math.min(30000, Math.max(0, Number(e.target.value || 0))) },
              }))}
              className="w-28 px-2 py-1 text-xs border rounded bg-white dark:bg-gray-900 dark:border-gray-700"
            />
          </label>
        </section>

        <section className="space-y-2">
          <div className="font-medium">Insertion behavior</div>
          <label className="inline-flex items-center gap-2 text-sm px-2 py-1 rounded-md bg-white/5 border border-white/10 backdrop-blur-sm">
            <input
              type="radio"
              className="h-4 w-4 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 accent-sky-600"
              name="insertion-mode"
              checked={(settings.insertionMode ?? 'overwrite') === 'overwrite'}
              onChange={() => setSettings((prev) => ({ ...prev, insertionMode: 'overwrite' }))}
            />
            Overwrite existing input
          </label>
          <label className="inline-flex items-center gap-2 text-sm px-2 py-1 rounded-md bg-white/5 border border-white/10 backdrop-blur-sm">
            <input
              type="radio"
              className="h-4 w-4 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 accent-sky-600"
              name="insertion-mode"
              checked={settings.insertionMode === 'append'}
              onChange={() => setSettings((prev) => ({ ...prev, insertionMode: 'append' }))}
            />
            Append to existing input
          </label>
        </section>

        <section className="space-y-2">
          <div className="font-medium">Page tweaks</div>
          <label className="inline-flex items-center gap-2 text-sm px-2 py-1 rounded-md bg-white/5 border border-white/10 backdrop-blur-sm">
            <input
              type="checkbox"
              className="h-4 w-4 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 accent-amber-500"
              checked={Boolean(settings.tweaks?.preventAutoScrollOnSubmit)}
              onChange={(e) => setSettings((prev) => ({
                ...prev,
                tweaks: { ...prev.tweaks, preventAutoScrollOnSubmit: e.target.checked },
              }))}
            />
            Prevent auto-scroll on submit
          </label>
        </section>

        {/* Storage/import/export and danger zone sections removed per product direction */}

        <section>
          <button className="w-full inline-flex items-center justify-center gap-2 text-sm px-3 py-2 rounded-xl bg-white/10 border border-white/15 backdrop-blur-md text-white shadow-lg shadow-sky-500/10 hover:bg-white/15" onClick={saveAll}>
            Save all settings
          </button>
        </section>
      </main>
    </div>
  )
}
