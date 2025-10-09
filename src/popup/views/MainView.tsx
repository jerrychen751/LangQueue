import { Plus, Play } from 'lucide-react'
import type { Prompt, SavedChain } from '../../types'
import { PromptCard } from '../components/PromptCard'
import { clickSendOnTab, sendPromptToTab } from '../../utils/messaging'
import { useToast } from '../../components/useToast'

interface MainViewProps {
  loading: boolean
  prompts: Prompt[]
  visiblePrompts: Prompt[]
  chains: SavedChain[]
  compatible: boolean
  onEditPrompt: (prompt: Prompt) => void
  onDeletePrompt: (prompt: Prompt) => void
  onInsertPrompt: (prompt: Prompt) => void
  onToggleFavorite: (prompt: Prompt) => void
  onRunChain: (chain: SavedChain) => void
  onRenameChain: (chain: SavedChain) => void
  onDeleteChain: (chain: SavedChain) => void
  onNewPrompt: () => void
}

export default function MainView({
  loading,
  prompts,
  visiblePrompts,
  chains,
  compatible,
  onEditPrompt,
  onDeletePrompt,
  onInsertPrompt,
  onToggleFavorite,
  onRunChain,
  onRenameChain,
  onDeleteChain,
  onNewPrompt,
}: MainViewProps) {
  const { showToast } = useToast()

  async function handleSend(prompt: Prompt) {
    try {
      await sendPromptToTab(prompt.content) // mirror card click injection
      await clickSendOnTab()
      showToast({ variant: 'success', message: 'Sent' })
      window.close()
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to send'
      showToast({ variant: 'error', message })
    }
  }

  return (
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
              onClick={onNewPrompt}
              className="inline-flex items-center justify-center gap-2 text-sm px-3 py-2 rounded-xl bg-white/10 border border-white/15 backdrop-blur-md text-white shadow-lg shadow-sky-500/10 hover:bg-white/15"
            >
              <Plus size={16} /> Create your first prompt
            </button>
          </div>
        </div>
      ) : !loading && visiblePrompts.length === 0 ? (
        <div className="text-sm text-gray-500 dark:text-gray-400 text-center py-12">No results. Try clearing filters or adjusting your search.</div>
      ) : (
        <>
          <div className="grid gap-3 grid-cols-1">
            {visiblePrompts.map((p) => (
              <PromptCard
                key={p.id}
                prompt={p}
                onEdit={() => onEditPrompt(p)}
                onDelete={() => onDeletePrompt(p)}
                onInsert={() => onInsertPrompt(p)}
                onSend={handleSend}
                onToggleFavorite={() => onToggleFavorite(p)}
                canInsert={compatible}
              />
            ))}
          </div>

          <div className="mt-4">
            <div className="px-1 py-2 text-xs font-medium text-gray-600 dark:text-gray-300">Chains</div>
            {chains.length === 0 ? (
              <div className="text-xs text-gray-500 dark:text-gray-400 px-1">No saved chains.</div>
            ) : (
              <ul className="divide-y rounded-md border dark:border-gray-700">
                {chains.map((c) => (
                  <li key={c.id} className="p-3 flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">{c.title}</div>
                      <div className="text-[11px] text-gray-500 dark:text-gray-400">{c.steps.length} step{c.steps.length === 1 ? '' : 's'}</div>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        className="inline-flex items-center gap-2 px-3 py-1.5 text-xs rounded-xl bg-emerald-600 text-white hover:bg-emerald-700"
                        onClick={() => onRunChain(c)}
                      >
                        <Play size={14} /> Run
                      </button>
                      <button
                        className="px-2 py-1.5 text-xs rounded-xl bg-white/10 border border-white/15 backdrop-blur-md text-white hover:bg-white/15"
                        onClick={() => onRenameChain(c)}
                      >
                        Edit
                      </button>
                      <button
                        className="px-2 py-1.5 text-xs rounded-xl bg-white/10 border border-white/15 backdrop-blur-md text-white hover:bg-white/15"
                        onClick={() => onDeleteChain(c)}
                      >
                        Delete
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}
    </main>
  )
}