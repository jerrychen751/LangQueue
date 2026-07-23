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
      const existing = await getSettings()
      // Prefill shortcut defaults by platform if not already set
      const isMac = /Mac|iPhone|iPad|iPod/.test(navigator.platform)
      const defaults = {
        openLibrary: isMac ? 'Command+Shift+P' : 'Ctrl+Shift+P',
        focusSearch: isMac ? 'Command+Shift+O' : 'Ctrl+Shift+O',
        createPrompt: isMac ? 'Command+Shift+L' : 'Ctrl+Shift+L',
      }
      const merged: AppSettings = {
        ...existing,
        multimodalEnabled: existing.multimodalEnabled ?? true,
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
        await saveSettings(settings)
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
    await saveSettings(settings)
    setStatus('Saved')
  }

  async function handleExport() {
    setExporting(true)
    try {
      const data = await exportLibrary({ includeBinaries: Boolean(settings.exportIncludeBinaries) })
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
      const results = await importLibrary(parsed)
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
      if (results.attachments) {
        summaryParts.push(`attachments imported ${results.attachments.imported}`)
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
    ? 'text-rose-700 border-rose-300 bg-rose-50'
    : 'text-[#3f6954] border-[#b5c9be] bg-[#eef4f0]'

  return (
    <div className="popup-shell">
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
      <header className="popup-header">
        <div className="flex items-center gap-3">
          <button className="icon-button" onClick={onBack} aria-label="Back">
            <ArrowLeft size={16} />
          </button>
          <div className="flex-1">
            <div className="popup-kicker">Workspace controls</div>
            <div className="popup-title">Settings</div>
          </div>
          {status ? (
            <div className={`rounded-[3px] border px-2.5 py-1 text-[9px] font-semibold uppercase tracking-[0.06em] ${statusTone}`} role="status">
              {status}
            </div>
          ) : null}
        </div>
      </header>

      <main className="popup-scroll space-y-3 pb-24 text-sm">
        <section className="settings-panel">
          <div className="settings-heading">Features</div>
          <div className="divide-y divide-[#d9dfe1]">
            <label className="flex items-center justify-between gap-3 px-4 py-3">
              <div>
                <div className="font-medium">Enable multimodal attachments</div>
                <div className="mt-1 text-[11px] text-[#6f7c82]">Add files and images to prompts and chains.</div>
              </div>
              <span className="relative inline-flex h-6 w-10 items-center">
                <input
                  type="checkbox"
                  className="peer sr-only"
                  checked={settings.multimodalEnabled !== false}
                  onChange={(e) => setSettings((prev) => ({ ...prev, multimodalEnabled: e.target.checked }))}
                />
                <span className="h-6 w-10 rounded-[3px] border border-[#cfd6d8] bg-[#dfe4e6] transition-colors peer-checked:border-[#527d8c] peer-checked:bg-[#527d8c] peer-focus-visible:ring-2 peer-focus-visible:ring-[#527d8c]/40" />
                <span className="absolute left-1 h-4 w-4 rounded-[2px] border border-[#c7d0d3] bg-white shadow-sm transition-transform peer-checked:translate-x-4" />
              </span>
            </label>
          </div>
        </section>

        <section className="settings-panel">
          <div className="settings-heading">Insertion behavior</div>
          <div className="grid grid-cols-2 gap-2 px-4 pb-4">
            <label className="cursor-pointer">
              <input
                type="radio"
                className="peer sr-only"
                name="insertion-mode"
                checked={(settings.insertionMode ?? 'overwrite') === 'overwrite'}
                onChange={() => setSettings((prev) => ({ ...prev, insertionMode: 'overwrite' }))}
              />
              <div className="rounded-[4px] border border-[#cfd6d8] bg-[#f8f9f9] p-3 text-xs text-[#46555c] transition peer-checked:border-[#527d8c] peer-checked:bg-[#eef3f5] peer-checked:text-[#1c272c]">
                <div className="text-sm font-medium">Overwrite</div>
                <div className="mt-1 text-[11px] opacity-70">Replace the current input</div>
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
              <div className="rounded-[4px] border border-[#cfd6d8] bg-[#f8f9f9] p-3 text-xs text-[#46555c] transition peer-checked:border-[#527d8c] peer-checked:bg-[#eef3f5] peer-checked:text-[#1c272c]">
                <div className="text-sm font-medium">Append</div>
                <div className="mt-1 text-[11px] opacity-70">Add after the current input</div>
              </div>
            </label>
          </div>
        </section>

        <section className="settings-panel">
          <div className="settings-heading">Page behavior</div>
          <div className="divide-y divide-[#d9dfe1]">
            <label className="flex items-center justify-between gap-3 px-4 py-3">
              <div>
                <div className="font-medium">Prevent auto-scroll on submit</div>
                <div className="mt-1 text-[11px] text-[#6f7c82]">Keep the page position after send.</div>
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
                <span className="h-6 w-10 rounded-[3px] border border-[#cfd6d8] bg-[#dfe4e6] transition-colors peer-checked:border-[#527d8c] peer-checked:bg-[#527d8c] peer-focus-visible:ring-2 peer-focus-visible:ring-[#527d8c]/40" />
                <span className="absolute left-1 h-4 w-4 rounded-[2px] border border-[#c7d0d3] bg-white shadow-sm transition-transform peer-checked:translate-x-4" />
              </span>
            </label>
          </div>
        </section>

        <section className="settings-panel">
          <div className="settings-heading">Import and export</div>
          <div className="divide-y divide-[#d9dfe1]">
            <div className="flex items-center justify-between gap-3 px-4 py-3">
                <div>
                  <div className="font-medium">Export library</div>
                  <div className="mt-1 text-[11px] text-[#6f7c82]">Save prompts and chains to Downloads.</div>
                </div>
                <button
                className="compact-button"
                onClick={handleExport}
                disabled={exporting}
              >
                {exporting ? 'Exporting…' : 'Export JSON'}
              </button>
            </div>
            <label className="flex items-center justify-between gap-3 px-4 py-3">
                <div>
                  <div className="font-medium">Include attachment binaries</div>
                  <div className="mt-1 text-[11px] text-[#6f7c82]">Make a larger file that includes attachments.</div>
                </div>
              <span className="relative inline-flex h-6 w-10 items-center">
                <input
                  type="checkbox"
                  className="peer sr-only"
                  checked={Boolean(settings.exportIncludeBinaries)}
                  onChange={(e) => setSettings((prev) => ({ ...prev, exportIncludeBinaries: e.target.checked }))}
                />
                <span className="h-6 w-10 rounded-[3px] border border-[#cfd6d8] bg-[#dfe4e6] transition-colors peer-checked:border-[#527d8c] peer-checked:bg-[#527d8c] peer-focus-visible:ring-2 peer-focus-visible:ring-[#527d8c]/40" />
                <span className="absolute left-1 h-4 w-4 rounded-[2px] border border-[#c7d0d3] bg-white shadow-sm transition-transform peer-checked:translate-x-4" />
              </span>
            </label>
            <div className="flex items-center justify-between gap-3 px-4 py-3">
                <div>
                  <div className="font-medium">Import from file</div>
                  <div className="mt-1 text-[11px] text-[#6f7c82]">Merge data and replace matching IDs.</div>
                </div>
                <button
                className="compact-button"
                onClick={() => fileInputRef.current?.click()}
                disabled={importing}
              >
                {importing ? 'Importing…' : 'Import JSON'}
              </button>
            </div>
            {importSummary ? (
              <div className="px-4 py-2 text-[11px] text-[#46555c]">{importSummary}</div>
            ) : null}
          </div>
        </section>
      </main>

      <footer className="popup-footer">
        <button
          className="primary-button w-full"
          onClick={saveAll}
        >
          Save settings
        </button>
      </footer>
    </div>
  )
}
