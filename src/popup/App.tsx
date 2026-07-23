import { useCallback, useEffect, useMemo, useState } from 'react'
import { Plus, Settings as SettingsIcon, Download, Workflow } from 'lucide-react'
import Logo from '../components/Logo'
import { PromptCard } from './PromptCard'
import PromptModal from '../components/PromptModal'
import type { Prompt, PromptChain } from '../types'
import { getAllPrompts, deletePrompt, getUsageStats, logUsage, getAllChains, saveChain, deleteChain, getPrompt, exportLibrary } from '../utils/storage'
import { sendPromptToTab, detectActivePlatform, clickSendOnTab } from '../utils/messaging'
import { useToast } from '../components/useToast'
import { checkTabCompatibility } from '../utils/messaging'
import FilterBar, { type SortOption } from '../components/FilterBar'
import Settings from './Settings'
import ChainBuilder from '../components/ChainBuilder'
import DeleteConfirmModal from '../components/DeleteConfirmModal'
import { downloadJson } from '../utils/download'

const PLATFORM_NAMES = {
  chatgpt: 'ChatGPT',
  gemini: 'Gemini',
  claude: 'Claude',
  other: 'No chat',
} as const

export default function App() {
  const [prompts, setPrompts] = useState<Prompt[]>([])
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<SortOption>('recent')
  const [loading, setLoading] = useState(true)
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState<Prompt | undefined>(undefined)
  const [compatible, setCompatible] = useState(false)
  const [checking, setChecking] = useState(true)
  const [platform, setPlatform] = useState<'chatgpt' | 'gemini' | 'claude' | 'other'>('other')
  
  const [stats, setStats] = useState<{ totalPrompts: number; totalUses: number; mostUsedPrompt: Prompt | null }>({ totalPrompts: 0, totalUses: 0, mostUsedPrompt: null })
  const [view, setView] = useState<'main' | 'settings'>('main')
  const [chainOpen, setChainOpen] = useState(false)
  const [chains, setChains] = useState<PromptChain[]>([])
  const [deleteChainTarget, setDeleteChainTarget] = useState<PromptChain | null>(null)
  const { showToast } = useToast()
  const [focusSearchSignal, setFocusSearchSignal] = useState(0)
  const [exporting, setExporting] = useState(false)
  const handleFilterChange = useCallback((next: { query: string; sort: SortOption }) => {
    setQuery(next.query)
    setSort(next.sort)
  }, [])

  useEffect(() => {
    const load = async () => {
      setLoading(true)
      try {
        await handleRefresh()
      } catch (err) {
        // Non-fatal: show a minimal inline error, but unblock UI
        console.error('Failed to load prompts/stats', err)
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  const openPromptById = useCallback(async (promptId: string) => {
    const prompt = await getPrompt(promptId)
    if (!prompt) return
    setEditing(prompt)
    setModalOpen(true)
  }, [])

  useEffect(() => {
    const handler: Parameters<typeof chrome.runtime.onMessage.addListener>[0] = (message) => {
      if (typeof message === 'object' && message && (message as { type?: string }).type === 'CHAIN_PROGRESS') {
          const { stepIndex, totalSteps, status, error } = (message as { payload?: { stepIndex?: number; totalSteps?: number; status?: string; error?: string } }).payload || {}
          if (!status || typeof stepIndex !== 'number' || typeof totalSteps !== 'number') return
          if (status === 'sending') {
            showToast({ message: `Step ${stepIndex + 1}/${totalSteps} sent` })
          }
          if (status === 'completed' && stepIndex === totalSteps - 1) {
            showToast({ variant: 'success', message: 'Chain completed!' })
          }
          if (status === 'error') {
            showToast({ variant: 'error', message: `Chain error: ${error ?? 'Unknown error'}` })
          }
          if (status === 'cancelled') {
            showToast({ variant: 'info', message: 'Chain cancelled' })
          }
      }
      if (typeof message === 'object' && message) {
        const type = (message as { type?: string }).type
        if (type === 'OPEN_NEW_PROMPT') {
          setEditing(undefined)
          setModalOpen(true)
        }
        if (type === 'OPEN_EDIT_PROMPT') {
          const promptId = (message as { payload?: { promptId?: string } }).payload?.promptId
          if (promptId) {
            void openPromptById(promptId)
          }
        }
        if (type === 'FOCUS_SEARCH') {
          setFocusSearchSignal((n) => n + 1)
        }
        if (type === 'TEXTAREA_READY') {
          setCompatible(true)
        }
        if (type === 'DB_CLEARED') {
          setView('main')
          handleRefresh()
        }
        if (type === 'PROMPTS_IMPORTED') {
          setView('main')
          handleRefresh()
        }
      }
    }
    chrome.runtime.onMessage.addListener(handler)
    return () => chrome.runtime.onMessage.removeListener(handler)
  }, [showToast, openPromptById])

  // When navigating back from settings to main, ensure latest prompts are shown
  useEffect(() => {
    if (view === 'main') {
      handleRefresh()
    }
  }, [view])

  // Refresh chains when chain builder closes
  useEffect(() => {
    if (!chainOpen) {
      handleRefresh()
    }
  }, [chainOpen])

  useEffect(() => {
    const check = async () => {
      setChecking(true)
      const ok = await checkTabCompatibility()
      setCompatible(ok)
      const p = await detectActivePlatform()
      setPlatform(p === 'chatgpt' || p === 'gemini' || p === 'claude' ? p : 'other')
      // Check for any pending action set by background shortcut
      const pending = await new Promise<unknown>((resolve) => {
        chrome.storage.local.get(['langqueue_pending_action'], (res) => resolve(res['langqueue_pending_action']))
      })
      if (pending === 'OPEN_NEW_PROMPT' || (pending && typeof pending === 'object' && (pending as { type?: string }).type === 'OPEN_NEW_PROMPT')) {
        setEditing(undefined)
        setModalOpen(true)
        chrome.storage.local.remove(['langqueue_pending_action'])
      }
      if (pending === 'FOCUS_SEARCH' || (pending && typeof pending === 'object' && (pending as { type?: string }).type === 'FOCUS_SEARCH')) {
        setFocusSearchSignal((n) => n + 1)
        chrome.storage.local.remove(['langqueue_pending_action'])
      }
      if (pending && typeof pending === 'object' && (pending as { type?: string }).type === 'OPEN_EDIT_PROMPT') {
        const promptId = (pending as { promptId?: string }).promptId
        if (promptId) {
          await openPromptById(promptId)
        }
        chrome.storage.local.remove(['langqueue_pending_action'])
      }
      setChecking(false)
    }
    check()
  }, [openPromptById])

  const visiblePrompts = useMemo(() => {
    const q = query.trim().toLowerCase()
    let list = [...prompts]
    if (q) {
      list = list.filter((p) => {
        const hay = [p.title, p.content].join('\n').toLowerCase()
        return hay.includes(q)
      })
    }
    switch (sort) {
      case 'alpha':
        list.sort((a, b) => a.title.localeCompare(b.title))
        break
      case 'mostUsed':
        list.sort((a, b) => (b.usageCount ?? 0) - (a.usageCount ?? 0))
        break
      case 'recent':
      default:
        list.sort((a, b) => {
          const byLast = (b.lastUsedAt ?? 0) - (a.lastUsedAt ?? 0)
          if (byLast !== 0) return byLast
          const byUpdated = (b.updatedAt ?? 0) - (a.updatedAt ?? 0)
          if (byUpdated !== 0) return byUpdated
          return (b.createdAt ?? 0) - (a.createdAt ?? 0)
        })
        break
    }
    return list
  }, [prompts, query, sort])

  async function handleRefresh() {
    const [items, savedChains, stats] = await Promise.all([
      getAllPrompts(),
      getAllChains(),
      getUsageStats(),
    ])
    setPrompts(items)
    setChains(savedChains)
    setStats(stats)
  }

  async function handleCreate() {
    setEditing(undefined)
    setModalOpen(true)
  }

  async function handleDelete(p: Prompt) {
    await deletePrompt(p.id)
    await handleRefresh()
  }

  async function handleInsert(p: Prompt) {
    try {
      await sendPromptToTab(p.content, p.attachments || [])
      showToast({ variant: 'success', message: `Inserted into ${platform === 'gemini' ? 'Gemini' : platform === 'claude' ? 'Claude' : 'ChatGPT'}` })
    } catch {
      await navigator.clipboard.writeText(p.content)
      showToast({ variant: 'info', message: 'Copied to clipboard' })
    }
    await logUsage({ timestamp: Date.now(), platform: compatible ? platform : 'other', promptId: p.id })
    await handleRefresh()
    window.close()
  }

  async function handleExport() {
    setExporting(true)
    try {
      const data = await exportLibrary()
      const date = new Date()
      const filename = `langqueue-backup-${date.toISOString().slice(0, 10)}.json`
      await downloadJson(filename, data)
      showToast({ variant: 'success', message: 'Exported to Downloads' })
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Export failed'
      showToast({ variant: 'error', message })
    } finally {
      setExporting(false)
    }
  }

  if (view === 'settings') {
    return <Settings onBack={() => setView('main')} />
  }

  const platformName = PLATFORM_NAMES[platform]

  return (
    <div className="popup-shell">
      <header className="popup-header">
        <div className="flex items-center gap-3">
          <div className="logo-frame">
            <Logo size={22} ariaLabel="LangQueue" />
          </div>
          <div>
            <div className="popup-kicker">Prompt operations</div>
            <div className="popup-title">LangQueue</div>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <div
              className="platform-status"
              data-ready={!checking && compatible}
              title={checking ? 'Detecting compatibility' : compatible ? `Ready on ${platformName}` : 'Open a supported chat page'}
            >
              <span className={`status-dot ${checking ? 'animate-pulse' : ''}`} aria-hidden />
              <span>{checking ? 'Detecting' : compatible ? platformName : 'Offline'}</span>
            </div>
            <button className="icon-button" onClick={() => setView('settings')} aria-label="Settings">
              <SettingsIcon size={15} />
            </button>
          </div>
        </div>
        <div className="mt-4">
          <FilterBar
            initialQuery={query}
            initialSort={sort}
            autoFocus={false}
            focusSignal={focusSearchSignal}
            onChange={handleFilterChange}
          />
        </div>
      </header>

      <main className="popup-scroll">
        {loading ? (
          <div className="section-label">Loading library</div>
        ) : prompts.length > 0 ? (
          <div className="section-label">
            <span>Prompt library</span>
            <span className="section-count">{visiblePrompts.length} / {prompts.length}</span>
          </div>
        ) : null}
        {!loading && prompts.length === 0 ? (
          <div className="empty-panel">
            <div>
              <div className="popup-kicker text-[#527d8c]">Library empty</div>
              <div className="mt-2 text-lg font-semibold">Save your first reusable prompt.</div>
              <div className="mt-2 text-xs leading-5 text-[#6f7c82]">Create it once, then insert it into any supported chat.</div>
              <button
                onClick={handleCreate}
                className="primary-button mt-5"
              >
                <Plus size={16} /> Create your first prompt
              </button>
            </div>
          </div>
        ) : !loading && visiblePrompts.length === 0 ? (
          <div className="empty-panel">
            <div>
              <div className="popup-kicker text-[#527d8c]">No match</div>
              <div className="mt-2 text-base font-semibold">Try another search.</div>
              <div className="mt-2 text-xs text-[#6f7c82]">Search checks prompt titles and content.</div>
            </div>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-1 gap-3">
              {visiblePrompts.map((p, index) => (
                <PromptCard
                  key={p.id}
                  index={index}
                  prompt={p}
                  onEdit={() => {
                    setEditing(p)
                    setModalOpen(true)
                  }}
                  onDelete={handleDelete}
                  onInsert={handleInsert}
                  onSend={async (prompt) => {
                    try {
                      await sendPromptToTab(prompt.content, prompt.attachments || [])
                      await clickSendOnTab()
                      showToast({ variant: 'success', message: 'Sent' })
                      window.close()
                    } catch (err: unknown) {
                      const message = err instanceof Error ? err.message : 'Failed to send'
                      showToast({ variant: 'error', message })
                    }
                  }}
                  canInsert={compatible}
                />
              ))}
            </div>

            <section className="mt-6">
              <div className="section-label">
                <span>Prompt chains</span>
                <span className="section-count">{chains.length}</span>
              </div>
              {chains.length === 0 ? (
                <div className="rounded-[4px] border border-dashed border-[#bdc7ca] px-3 py-4 text-xs text-[#6f7c82]">
                  Link prompts into a repeatable sequence.
                </div>
              ) : (
                <ul className="space-y-2">
                  {chains.map((c, index) => (
                    <li key={c.id} className="chain-card">
                      <div className="chain-number">{String(index + 1).padStart(2, '0')}</div>
                      <div className="min-w-0">
                        <div className="truncate text-xs font-semibold text-[#1c272c]">{c.title}</div>
                        <div className="mt-1 text-[10px] text-[#6f7c82]">
                          {c.steps.length} step{c.steps.length === 1 ? '' : 's'}
                        </div>
                      </div>
                      <div className="ml-auto flex items-center gap-1.5">
                        <button
                          className="compact-button"
                          onClick={async () => {
                            const nextTitle = prompt('Rename chain', c.title)?.trim()
                            if (!nextTitle) return
                            const updated: PromptChain = { ...c, title: nextTitle, updatedAt: Date.now() }
                            await saveChain(updated)
                            await handleRefresh()
                          }}
                        >
                          Edit
                        </button>
                        <button
                          className="compact-button"
                          onClick={async () => {
                            setDeleteChainTarget(c)
                          }}
                        >
                          Delete
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </>
        )}
      </main>

      {loading ? (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-[#f2f4f3]/90 backdrop-blur-sm">
          <div className="flex flex-col items-center gap-3">
            <div className="loading-orbit" aria-label="Loading" />
            <div className="popup-kicker">Loading library</div>
          </div>
        </div>
      ) : null}

      <footer className="popup-footer">
        <div className="mb-2.5 flex items-center gap-3 text-[10px] text-[#6f7c82]">
          <span><strong className="text-[#1c272c]">{stats.totalPrompts}</strong> prompts</span>
          <span><strong className="text-[#1c272c]">{stats.totalUses}</strong> uses</span>
          <button className="text-button ml-auto inline-flex items-center gap-1.5" onClick={handleExport} disabled={exporting}>
            <Download size={11} />
            {exporting ? 'Exporting' : 'Export'}
          </button>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <button
            onClick={() => setChainOpen(true)}
            className="secondary-button"
          >
            <Workflow size={15} /> New chain
          </button>
          <button
            onClick={handleCreate}
            className="primary-button"
          >
            <Plus size={15} /> New prompt
          </button>
        </div>
      </footer>

      <PromptModal
        open={modalOpen}
        initialPrompt={editing}
        onClose={() => setModalOpen(false)}
        onSaved={async (saved) => {
          // Optimistically update local list immediately for snappy UX
          setPrompts((prev) => {
            const existingIdx = prev.findIndex((p) => p.id === saved.id)
            if (existingIdx >= 0) {
              const next = [...prev]
              next[existingIdx] = saved
              return next
            }
            return [saved, ...prev]
          })
          // Then ensure canonical ordering and stats from storage
          await handleRefresh()
          setModalOpen(false)
        }}
      />

      <ChainBuilder
        open={chainOpen}
        onClose={() => setChainOpen(false)}
      />
      <DeleteConfirmModal
        open={Boolean(deleteChainTarget)}
        title="Delete chain?"
        description={deleteChainTarget ? `"${deleteChainTarget.title}" will be removed from your library.` : 'This action cannot be undone.'}
        confirmLabel="Delete chain"
        onCancel={() => setDeleteChainTarget(null)}
        onConfirm={async () => {
          if (!deleteChainTarget) return
          await deleteChain(deleteChainTarget.id)
          await handleRefresh()
          setDeleteChainTarget(null)
        }}
      />
    </div>
  )
}
