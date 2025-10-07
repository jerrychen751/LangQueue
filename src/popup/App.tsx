import { useEffect, useMemo, useState } from 'react'
import { Sparkles, Plus, Settings as SettingsIcon, ArrowLeft } from 'lucide-react'
import { PromptCard } from './PromptCard'
import PromptModal from '../components/PromptModal'
import type { Prompt } from '../types'
import { getAllPrompts, updatePrompt, deletePrompt, getUsageStats, logUsage } from '../utils/storage'
import { sendPromptToTab, detectActivePlatform } from '../utils/messaging'
import { useToast } from '../components/useToast'
import { checkTabCompatibility } from '../utils/messaging'
import FilterBar, { type SortOption } from '../components/FilterBar'
import Settings from './Settings'

export default function App() {
  const [prompts, setPrompts] = useState<Prompt[]>([])
  const [query, setQuery] = useState('')
  const [favoritesOnly, setFavoritesOnly] = useState(false)
  const [sort, setSort] = useState<SortOption>('recent')
  const [loading, setLoading] = useState(true)
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState<Prompt | undefined>(undefined)
  const [compatible, setCompatible] = useState(false)
  const [checking, setChecking] = useState(true)
  const [platform, setPlatform] = useState<'chatgpt' | 'gemini' | 'other'>('other')
  
  const [stats, setStats] = useState<{ totalPrompts: number; totalUses: number; mostUsedPrompt: Prompt | null }>({ totalPrompts: 0, totalUses: 0, mostUsedPrompt: null })
  const [view, setView] = useState<'main' | 'settings'>('main')
  const { showToast } = useToast()

  useEffect(() => {
    const load = async () => {
      setLoading(true)
      await handleRefresh()
      setLoading(false)
    }
    load()
  }, [])

  useEffect(() => {
    const handler: Parameters<typeof chrome.runtime.onMessage.addListener>[0] = (message) => {
      if (typeof message === 'object' && message) {
        const type = (message as { type?: string }).type
        if (type === 'OPEN_NEW_PROMPT') {
          setEditing(undefined)
          setModalOpen(true)
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
  }, [])

  // When navigating back from settings to main, ensure latest prompts are shown
  useEffect(() => {
    if (view === 'main') {
      handleRefresh()
    }
  }, [view])

  useEffect(() => {
    const check = async () => {
      setChecking(true)
      const ok = await checkTabCompatibility()
      setCompatible(ok)
      const p = await detectActivePlatform()
      setPlatform(p === 'chatgpt' || p === 'gemini' ? p : 'other')
      // Check for any pending action set by background shortcut
      const pending = await new Promise<string | undefined>((resolve) => {
        chrome.storage.local.get(['langqueue_pending_action'], (res) => resolve(res['langqueue_pending_action']))
      })
      if (pending === 'OPEN_NEW_PROMPT') {
        setEditing(undefined)
        setModalOpen(true)
        chrome.storage.local.remove(['langqueue_pending_action'])
      }
      setChecking(false)
    }
    check()
  }, [])

  const visiblePrompts = useMemo(() => {
    const q = query.trim().toLowerCase()
    let list = [...prompts]
    if (q) {
      list = list.filter((p) => {
        const hay = [p.title, p.description ?? '', p.content, p.category ?? '', ...(p.tags ?? [])]
          .join('\n')
          .toLowerCase()
        return hay.includes(q)
      })
    }
    if (favoritesOnly) list = list.filter((p) => p.isFavorite)
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
  }, [prompts, query, favoritesOnly, sort])

  async function handleRefresh() {
    const items = await getAllPrompts('local')
    setPrompts(items)
    setStats(await getUsageStats('local'))
  }

  async function handleCreate() {
    setEditing(undefined)
    setModalOpen(true)
  }

  async function handleToggleFavorite(p: Prompt) {
    await updatePrompt(p.id, { isFavorite: !p.isFavorite }, 'local')
    await handleRefresh()
  }

  async function handleDelete(p: Prompt) {
    await deletePrompt(p.id, 'local')
    await handleRefresh()
  }

  async function handleInsert(p: Prompt) {
    try {
      await sendPromptToTab(p.content)
      showToast({ variant: 'success', message: `Inserted into ${platform === 'gemini' ? 'Gemini' : 'ChatGPT'}` })
    } catch {
      await navigator.clipboard.writeText(p.content)
      showToast({ variant: 'info', message: 'Copied to clipboard' })
    }
    await logUsage({ timestamp: Date.now(), platform: compatible ? platform : 'other', promptId: p.id }, 'local')
    await handleRefresh()
    window.close()
  }

  return (
    <div className="w-popup min-w-popup max-w-popup h-[600px] bg-white text-gray-900 dark:bg-gray-900 dark:text-gray-100 flex flex-col">
      <header className="border-b bg-gradient-to-r from-gray-900 via-gray-800 to-gray-900">
        <div className="flex items-center gap-2 p-3">
          {view === 'settings' ? (
            <button className="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-800" onClick={() => setView('main')} aria-label="Back">
              <ArrowLeft size={16} />
            </button>
          ) : null}
          <Sparkles size={18} className="text-sky-400" />
          <div className="font-medium bg-clip-text text-transparent bg-gradient-to-r from-sky-400 via-purple-400 to-pink-400">LangQueue</div>
          <div className="ml-auto flex items-center gap-2 text-xs" title={checking ? 'Detecting compatibility…' : compatible ? `Ready on ${platform === 'gemini' ? 'Gemini' : 'ChatGPT'}` : 'Not detected on current tab'}>
            <span
              className={`inline-block w-2 h-2 rounded-full ${checking ? 'bg-gray-300 dark:bg-gray-700 animate-pulse' : compatible ? 'bg-emerald-500' : 'bg-gray-300 dark:bg-gray-700'}`}
              aria-hidden
            />
            <span className={compatible ? 'text-emerald-700 dark:text-emerald-300' : 'text-gray-500 dark:text-gray-400'}>
              {checking ? 'Detecting…' : compatible ? (platform === 'gemini' ? 'Gemini detected' : 'ChatGPT detected') : 'Open ChatGPT or Gemini to enable Insert'}
            </span>
            {view === 'main' ? (
              <button className="ml-2 p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-800" onClick={() => setView('settings')} aria-label="Settings">
                <SettingsIcon size={16} />
              </button>
            ) : null}
          </div>
        </div>
        <div className="px-3 pb-3">
          {view === 'main' ? (
            <FilterBar
              initialQuery={query}
              initialFavoritesOnly={favoritesOnly}
              initialSort={sort}
              onChange={(s) => {
                setQuery(s.query)
                setFavoritesOnly(s.favoritesOnly)
                setSort(s.sort)
              }}
            />
          ) : (
            <div className="text-xs text-gray-500 dark:text-gray-400">Configure settings below.</div>
          )}
        </div>
      </header>

      {view === 'settings' ? (
        <Settings onBack={() => setView('main')} />
      ) : (
      <main className="flex-1 overflow-auto p-3">
        {loading ? (
          <div className="text-sm text-gray-500 dark:text-gray-400">Loading…</div>
        ) : prompts.length > 0 ? (
          <div className="text-xs text-gray-500 dark:text-gray-400 mb-2">Showing {visiblePrompts.length} of {prompts.length} prompts</div>
        ) : null}
        {!loading && prompts.length === 0 ? (
          <div className="text-sm text-gray-600 dark:text-gray-300 text-center py-12 space-y-3">
            <div className="text-base font-medium">You have no prompts yet</div>
            <div className="text-xs text-gray-500 dark:text-gray-400">Create your first prompt to get started.</div>
            <div>
              <button
                onClick={handleCreate}
                className="inline-flex items-center justify-center gap-2 text-sm px-3 py-2 rounded-xl bg-white/10 border border-white/15 backdrop-blur-md text-white shadow-lg shadow-sky-500/10 hover:bg-white/15"
              >
                <Plus size={16} /> Create your first prompt
              </button>
            </div>
          </div>
        ) : !loading && visiblePrompts.length === 0 ? (
          <div className="text-sm text-gray-500 dark:text-gray-400 text-center py-12">No results. Try clearing filters or adjusting your search.</div>
        ) : (
          <div className="grid gap-3 grid-cols-1">
            {visiblePrompts.map((p) => (
              <PromptCard
                key={p.id}
                prompt={p}
                onEdit={() => {
                  setEditing(p)
                  setModalOpen(true)
                }}
                onDelete={handleDelete}
                onInsert={handleInsert}
                onToggleFavorite={handleToggleFavorite}
                canInsert={compatible}
              />
            ))}
          </div>
        )}
      </main>
      )}

      <footer className="border-t p-3">
        <div className="text-xs text-gray-600 dark:text-gray-400 mb-2 flex items-center gap-4">
          <span>Total prompts: <span className="font-medium">{stats.totalPrompts}</span></span>
          <span>Total uses: <span className="font-medium">{stats.totalUses}</span></span>
        </div>
        <button
          onClick={handleCreate}
          className="w-full inline-flex items-center justify-center gap-2 text-sm px-3 py-2 rounded-xl bg-white/10 border border-white/15 backdrop-blur-md text-white shadow-lg shadow-sky-500/10 hover:bg-white/15"
        >
          <Plus size={16} />
          New Prompt
        </button>
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
    </div>
  )
}


