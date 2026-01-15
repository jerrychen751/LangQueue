import { useEffect, useRef, useState } from 'react'
import { ArrowLeft } from 'lucide-react'
import type { AppSettings } from '../types'
import { getSettings, saveSettings, exportLibrary, importLibrary } from '../utils/storage'
import { useToast } from '../components/useToast'
import { downloadJson } from '../utils/download'

type SettingsProps = {
  onBack: () => void
}

export default function Settings({ onBack }: SettingsProps) {
  const [settings, setSettings] = useState<AppSettings>({})
  const [status, setStatus] = useState<string | null>(null)
  const [importing, setImporting] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [importSummary, setImportSummary] = useState<string | null>(null)
  const { showToast } = useToast()
  const autosaveTimerRef = useRef<number | null>(null)
  const didHydrateRef = useRef(false)
  const fileInputRef = useRef<HTMLInputElement | null>(null)

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

  async function saveAll() {
    await saveSettings(settings, 'local')
    setStatus('Saved')
  }

  async function handleExport() {
    setExporting(true)
    try {
      const data = await exportLibrary('local')
      const filename = `langqueue-backup-${new Date().toISOString().slice(0, 10)}.json`
      await downloadJson(filename, data)
      showToast({ variant: 'success', message: 'Exported to Downloads' })
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Export failed'
      showToast({ variant: 'error', message })
    } finally {
      setExporting(false)
    }
  }

  async function handleImportFile(file: File) {
    setImporting(true)
    setImportSummary(null)
    try {
      const text = await file.text()
      const parsed = JSON.parse(text)
      const results = await importLibrary(parsed, 'local')
      const promptStats = results.prompts
      const chainStats = results.chains
      const summaryParts: string[] = []
      if (promptStats) {
        summaryParts.push(
          `prompts imported ${promptStats.imported}, replaced ${promptStats.replaced}, skipped ${promptStats.skipped}`
        )
      }
      if (chainStats) {
        summaryParts.push(
          `chains imported ${chainStats.imported}, replaced ${chainStats.replaced}, skipped ${chainStats.skipped}`
        )
      }
      const summary = summaryParts.join(' • ') || 'No items imported'
      setImportSummary(summary)
      showToast({ variant: 'success', message: 'Import completed' })
      chrome.runtime.sendMessage({ type: 'PROMPTS_IMPORTED' }).catch(() => {
        // best-effort notification
      })
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Import failed'
      showToast({ variant: 'error', message })
      setImportSummary(null)
    } finally {
      setImporting(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  const statusTone = status?.toLowerCase().includes('fail')
    ? 'text-rose-200 border-rose-400/30 bg-rose-500/15'
    : 'text-emerald-200 border-emerald-400/30 bg-emerald-500/15'

  return (
    <div className="w-popup min-w-popup max-w-popup h-[600px] bg-slate-950 text-slate-100 flex flex-col bg-[radial-gradient(120%_120%_at_50%_0%,rgba(56,189,248,0.12),transparent_60%)]">
      <input
        ref={fileInputRef}
        type="file"
        accept="application/json"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0]
          if (file) void handleImportFile(file)
        }}
      />
      <header className="border-b border-white/10 px-3 pt-3 pb-2">
        <div className="flex items-center gap-2">
          <button className="p-2 rounded-full hover:bg-white/10 transition" onClick={onBack} aria-label="Back">
            <ArrowLeft size={16} />
          </button>
          <div className="flex-1">
            <div className="text-sm font-semibold">Settings</div>
            <div className="text-xs text-slate-400">Tune how LangQueue behaves.</div>
          </div>
          {status ? (
            <div className={`text-[10px] uppercase tracking-wide px-2 py-1 rounded-full border ${statusTone}`} role="status">
              {status}
            </div>
          ) : null}
        </div>
      </header>

      <main className="flex-1 overflow-auto px-3 pt-3 pb-4 space-y-4 text-sm">
        <section className="rounded-2xl border border-white/10 bg-white/5">
          <div className="px-4 pt-3 pb-2 text-[11px] uppercase tracking-wide text-slate-400">Chain defaults</div>
          <div className="divide-y divide-white/10">
            <label className="flex items-center justify-between gap-3 px-4 py-3">
              <div>
                <div className="font-medium">Auto-send prompts</div>
                <div className="text-xs text-slate-400">Send each step automatically.</div>
              </div>
              <span className="relative inline-flex h-6 w-10 items-center">
                <input
                  type="checkbox"
                  className="peer sr-only"
                  checked={(settings.chainDefaults?.autoSend ?? true)}
                  onChange={(e) => setSettings((prev) => ({
                    ...prev,
                    chainDefaults: { ...prev.chainDefaults, autoSend: e.target.checked },
                  }))}
                />
                <span className="h-6 w-10 rounded-full bg-slate-700/80 border border-white/10 transition-colors peer-checked:bg-amber-500/80 peer-focus-visible:ring-2 peer-focus-visible:ring-sky-400/70" />
                <span className="absolute left-1 h-4 w-4 rounded-full bg-white shadow transition-transform peer-checked:translate-x-4" />
              </span>
            </label>
            <label className="flex items-center justify-between gap-3 px-4 py-3">
              <div>
                <div className="font-medium">Wait for response</div>
                <div className="text-xs text-slate-400">Pause between steps until a reply.</div>
              </div>
              <span className="relative inline-flex h-6 w-10 items-center">
                <input
                  type="checkbox"
                  className="peer sr-only"
                  checked={(settings.chainDefaults?.awaitResponse ?? true)}
                  onChange={(e) => setSettings((prev) => ({
                    ...prev,
                    chainDefaults: { ...prev.chainDefaults, awaitResponse: e.target.checked },
                  }))}
                />
                <span className="h-6 w-10 rounded-full bg-slate-700/80 border border-white/10 transition-colors peer-checked:bg-amber-500/80 peer-focus-visible:ring-2 peer-focus-visible:ring-sky-400/70" />
                <span className="absolute left-1 h-4 w-4 rounded-full bg-white shadow transition-transform peer-checked:translate-x-4" />
              </span>
            </label>
            <div className="flex items-center justify-between gap-3 px-4 py-3">
              <div>
                <div className="font-medium">Delay between prompts</div>
                <div className="text-xs text-slate-400">Milliseconds between steps.</div>
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min={0}
                  max={30000}
                  value={(settings.chainDefaults?.defaultDelayMs ?? 1000)}
                  onChange={(e) => setSettings((prev) => ({
                    ...prev,
                    chainDefaults: { ...prev.chainDefaults, defaultDelayMs: Math.min(30000, Math.max(0, Number(e.target.value || 0))) },
                  }))}
                  className="w-20 px-2 py-1 text-xs text-right rounded-lg border border-white/10 bg-slate-900/80 text-slate-100"
                />
                <span className="text-xs text-slate-400">ms</span>
              </div>
            </div>
          </div>
        </section>

        <section className="rounded-2xl border border-white/10 bg-white/5">
          <div className="px-4 pt-3 pb-2 text-[11px] uppercase tracking-wide text-slate-400">Insertion behavior</div>
          <div className="grid grid-cols-2 gap-2 px-4 pb-4">
            <label className="cursor-pointer">
              <input
                type="radio"
                className="peer sr-only"
                name="insertion-mode"
                checked={(settings.insertionMode ?? 'overwrite') === 'overwrite'}
                onChange={() => setSettings((prev) => ({ ...prev, insertionMode: 'overwrite' }))}
              />
              <div className="rounded-xl border border-white/10 bg-slate-900/40 p-3 text-xs text-slate-300 transition peer-checked:border-sky-400/60 peer-checked:bg-sky-500/15 peer-checked:text-slate-100">
                <div className="text-sm font-medium">Overwrite</div>
                <div className="mt-1 text-[11px] opacity-70">Replace current input</div>
              </div>
            </label>
            <label className="cursor-pointer">
              <input
                type="radio"
                className="peer sr-only"
                name="insertion-mode"
                checked={settings.insertionMode === 'append'}
                onChange={() => setSettings((prev) => ({ ...prev, insertionMode: 'append' }))}
              />
              <div className="rounded-xl border border-white/10 bg-slate-900/40 p-3 text-xs text-slate-300 transition peer-checked:border-sky-400/60 peer-checked:bg-sky-500/15 peer-checked:text-slate-100">
                <div className="text-sm font-medium">Append</div>
                <div className="mt-1 text-[11px] opacity-70">Keep and add after</div>
              </div>
            </label>
          </div>
        </section>

        <section className="rounded-2xl border border-white/10 bg-white/5">
          <div className="px-4 pt-3 pb-2 text-[11px] uppercase tracking-wide text-slate-400">Page tweaks</div>
          <div className="divide-y divide-white/10">
            <label className="flex items-center justify-between gap-3 px-4 py-3">
              <div>
                <div className="font-medium">Prevent auto-scroll on submit</div>
                <div className="text-xs text-slate-400">Keep the page from jumping after send.</div>
              </div>
              <span className="relative inline-flex h-6 w-10 items-center">
                <input
                  type="checkbox"
                  className="peer sr-only"
                  checked={Boolean(settings.tweaks?.preventAutoScrollOnSubmit)}
                  onChange={(e) => setSettings((prev) => ({
                    ...prev,
                    tweaks: { ...prev.tweaks, preventAutoScrollOnSubmit: e.target.checked },
                  }))}
                />
                <span className="h-6 w-10 rounded-full bg-slate-700/80 border border-white/10 transition-colors peer-checked:bg-amber-500/80 peer-focus-visible:ring-2 peer-focus-visible:ring-sky-400/70" />
                <span className="absolute left-1 h-4 w-4 rounded-full bg-white shadow transition-transform peer-checked:translate-x-4" />
              </span>
            </label>
          </div>
        </section>

        <section className="rounded-2xl border border-white/10 bg-white/5">
          <div className="px-4 pt-3 pb-2 text-[11px] uppercase tracking-wide text-slate-400">Import / Export</div>
          <div className="divide-y divide-white/10">
            <div className="flex items-center justify-between gap-3 px-4 py-3">
              <div>
                <div className="font-medium">Export library</div>
                <div className="text-xs text-slate-400">Prompts and chains saved to Downloads.</div>
              </div>
              <button
                className="px-3 py-2 text-xs rounded-xl border border-white/10 bg-slate-900/60 hover:bg-slate-800/80 disabled:opacity-60 disabled:cursor-not-allowed"
                onClick={handleExport}
                disabled={exporting}
              >
                {exporting ? 'Exporting…' : 'Export JSON'}
              </button>
            </div>
            <div className="flex items-center justify-between gap-3 px-4 py-3">
              <div>
                <div className="font-medium">Import from file</div>
                <div className="text-xs text-slate-400">Merge and replace duplicates by ID.</div>
              </div>
              <button
                className="px-3 py-2 text-xs rounded-xl border border-white/10 bg-slate-900/60 hover:bg-slate-800/80 disabled:opacity-60 disabled:cursor-not-allowed"
                onClick={() => fileInputRef.current?.click()}
                disabled={importing}
              >
                {importing ? 'Importing…' : 'Import JSON'}
              </button>
            </div>
            {importSummary ? (
              <div className="px-4 py-2 text-[11px] text-slate-300">{importSummary}</div>
            ) : null}
          </div>
        </section>
      </main>

      <footer className="border-t border-white/10 p-3 bg-slate-950/90 backdrop-blur">
        <button
          className="w-full inline-flex items-center justify-center gap-2 text-sm px-4 py-3 rounded-2xl bg-emerald-400 text-slate-950 font-semibold shadow-lg shadow-emerald-500/20 hover:bg-emerald-300 transition"
          onClick={saveAll}
        >
          Save settings
        </button>
      </footer>
    </div>
  )
}
