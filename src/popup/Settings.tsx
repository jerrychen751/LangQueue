import { useEffect, useRef, useState } from 'react'
import { ArrowLeft, Download, Upload, Trash2, Keyboard } from 'lucide-react'
import type { AppSettings, PromptExportFile, ImportMode, DuplicateStrategy } from '../types'
import { clearAllData, exportPrompts, getAllPrompts, getSettings, importPrompts, saveSettings } from '../utils/storage'
import { useToast } from '../components/useToast'

type SettingsProps = {
  onBack: () => void
}

export default function Settings({ onBack }: SettingsProps) {
  const [settings, setSettings] = useState<AppSettings>({})
  const [stats, setStats] = useState<{ totalPrompts: number; storageKb: number }>({ totalPrompts: 0, storageKb: 0 })
  const [status, setStatus] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const [importMode, setImportMode] = useState<ImportMode>('merge')
  const [dupStrategy, setDupStrategy] = useState<DuplicateStrategy>('skip')
  const { showToast } = useToast()
  const autosaveTimerRef = useRef<number | null>(null)
  const didHydrateRef = useRef(false)

  useEffect(() => {
    const load = async () => {
      const existing = await getSettings('local')
      // Prefill shortcut defaults by platform if not already set
      const isMac = /Mac|iPhone|iPad|iPod/.test(navigator.platform)
      const defaults = {
        openLibrary: isMac ? 'Command+Shift+P' : 'Ctrl+Shift+P',
        enhancePrompt: isMac ? 'Command+Shift+E' : 'Ctrl+Shift+E',
        createPrompt: isMac ? 'Command+Shift+C' : 'Ctrl+Shift+C',
      }
      const merged: AppSettings = {
        ...existing,
        shortcuts: {
          openLibrary: existing.shortcuts?.openLibrary ?? defaults.openLibrary,
          enhancePrompt: existing.shortcuts?.enhancePrompt ?? defaults.enhancePrompt,
          // Backward compatibility: prefer new key, fallback to legacy savePrompt key, then default
          createPrompt: existing.shortcuts?.createPrompt ?? existing.shortcuts?.savePrompt ?? defaults.createPrompt,
        },
      }
      setSettings(merged)
      const prompts = await getAllPrompts('local')
      const storageKb = Math.round((JSON.stringify(prompts).length / 1024) * 10) / 10
      setStats({ totalPrompts: prompts.length, storageKb })
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

  async function handleExport() {
    setStatus(null)
    const data = await exportPrompts('local')
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `langqueue_prompts_${new Date().toISOString()}.json`
    a.click()
    URL.revokeObjectURL(url)
    setStatus('Exported prompts to file.')
  }

  async function handleImportFile(file: File) {
    setStatus(null)
    try {
      const text = await file.text()
      const json = JSON.parse(text) as PromptExportFile
      const res = await importPrompts(json, { mode: importMode, duplicateStrategy: dupStrategy }, 'local')
      setStatus(`Imported: ${res.imported}, Replaced: ${res.replaced}, Duplicated: ${res.duplicated}, Skipped: ${res.skipped}`)
      const prompts = await getAllPrompts('local')
      const storageKb = Math.round((JSON.stringify(prompts).length / 1024) * 10) / 10
      setStats({ totalPrompts: prompts.length, storageKb })
      chrome.runtime.sendMessage({ type: 'PROMPTS_IMPORTED' })
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Import failed: invalid JSON or format.'
      setStatus(message)
    }
  }

  function openImport() {
    fileInputRef.current?.click()
  }

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
              <span className="w-36 text-gray-600 dark:text-gray-300">Enhance prompt</span>
              <span className="inline-flex items-center text-xs px-2 py-1 rounded-md bg-white/5 border border-white/10 backdrop-blur-sm">
                {formatShortcut(settings.shortcuts?.enhancePrompt ?? '')}
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

        {null}

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
          <div className="font-medium">Storage</div>
          <div className="text-gray-600 dark:text-gray-300">{stats.totalPrompts} prompts, ~{stats.storageKb} KB</div>
          <div className="flex items-center gap-2">
            <button className="inline-flex items-center gap-2 px-3 py-1.5 text-sm rounded-xl bg-white/10 border border-white/15 backdrop-blur-md text-white shadow-lg shadow-sky-500/10 hover:bg-white/15" onClick={handleExport}>
              <Download size={14} /> Export JSON
            </button>
            <input ref={fileInputRef} type="file" accept="application/json" className="hidden" onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) handleImportFile(f)
              e.currentTarget.value = ''
            }} />
            <button className="inline-flex items-center gap-2 px-3 py-1.5 text-sm rounded-xl bg-white/10 border border-white/15 backdrop-blur-md text-white shadow-lg shadow-sky-500/10 hover:bg-white/15" onClick={openImport}>
              <Upload size={14} /> Import JSON
            </button>
          </div>
          <div className="flex items-center gap-2">
            <label className="inline-flex items-center gap-2">
              <span className="text-gray-600 dark:text-gray-300">Import mode</span>
              <select value={importMode} onChange={(e) => setImportMode(e.target.value as ImportMode)} className="border rounded px-2 py-1 bg-white dark:bg-gray-800 dark:border-gray-700">
                <option value="merge">Merge</option>
                <option value="replace">Replace</option>
              </select>
            </label>
            <label className="inline-flex items-center gap-2">
              <span className="text-gray-600 dark:text-gray-300">Duplicates</span>
              <select value={dupStrategy} onChange={(e) => setDupStrategy(e.target.value as DuplicateStrategy)} className="border rounded px-2 py-1 bg-white dark:bg-gray-800 dark:border-gray-700">
                <option value="skip">Skip</option>
                <option value="replace">Replace</option>
                <option value="duplicate">Duplicate</option>
              </select>
            </label>
          </div>
        </section>

        <section className="space-y-2">
          <div className="font-medium text-rose-700">Danger zone</div>
          <button
            className="inline-flex items-center gap-2 px-3 py-1.5 text-sm rounded-xl bg-rose-600/20 border border-rose-400/40 text-rose-200 backdrop-blur-md hover:bg-rose-600/25"
            onClick={async () => {
              if (!confirm('This will clear all prompts and usage data. Continue?')) return
              try {
                await clearAllData('local')
                // Keep dark theme enforced
                document.documentElement.classList.add('dark')
                setStatus('All data cleared')
                setStats({ totalPrompts: 0, storageKb: 0 })
                showToast({ variant: 'success', message: 'All data cleared' })
                // Notify popup to refresh and return to main view
                chrome.runtime.sendMessage({ type: 'DB_CLEARED' })
              } catch (err: unknown) {
                const message = err instanceof Error ? err.message : 'Failed to clear data'
                setStatus(message)
              }
            }}
          >
            <Trash2 size={14} /> Clear all data
          </button>
        </section>

        <section>
          <button className="w-full inline-flex items-center justify-center gap-2 text-sm px-3 py-2 rounded-xl bg-white/10 border border-white/15 backdrop-blur-md text-white shadow-lg shadow-sky-500/10 hover:bg-white/15" onClick={saveAll}>
            Save all settings
          </button>
        </section>
      </main>
    </div>
  )
}


