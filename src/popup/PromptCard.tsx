import { Star, Pencil, Trash2, Send, Tag as TagIcon } from 'lucide-react'
import type { Prompt } from '../types'
import { useToast } from '../components/useToast'
import DeleteConfirmModal from '../components/DeleteConfirmModal'
import { useState } from 'react'

type PromptCardProps = {
  prompt: Prompt
  onEdit: (prompt: Prompt) => void
  onDelete: (prompt: Prompt) => void
  onInsert: (prompt: Prompt) => void
  onSend?: (prompt: Prompt) => void
  onToggleFavorite: (prompt: Prompt) => void
  canInsert?: boolean
}

function hashColorFromTag(tag: string): string {
  const palette = [
    'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-200',
    'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-200',
    'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-200',
    'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-200',
    'bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-200',
    'bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-200',
  ]
  let sum = 0
  for (let i = 0; i < tag.length; i++) sum = (sum + tag.charCodeAt(i)) % palette.length
  return palette[sum]
}

export function PromptCard({ prompt, onEdit, onDelete, onInsert, onSend, onToggleFavorite, canInsert = true }: PromptCardProps) {
  const { showToast } = useToast()
  const [confirmOpen, setConfirmOpen] = useState(false)

  return (
    <>
    <div className="rounded-lg p-[1px] bg-gradient-to-br from-sky-500/20 via-purple-500/20 to-pink-500/20">
    <div
      className={`border rounded-lg p-3 shadow-sm hover:shadow-lg transition bg-white dark:bg-gray-900 dark:border-gray-700 ${canInsert ? 'cursor-pointer' : 'cursor-default'}`}
      onClick={async () => { if (canInsert) await onInsert(prompt) }}
      title={canInsert ? 'Click to insert' : 'Open ChatGPT tab to enable insert'}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium text-gray-900 dark:text-gray-100 break-words max-w-full" title={prompt.title}>
            {prompt.title || 'Untitled'}
          </div>
          <div className="relative mt-1 overflow-hidden">
            <div
              className="text-[11px] leading-5 text-gray-600 dark:text-gray-300 whitespace-pre-wrap break-words overflow-hidden"
              style={{ display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical' as unknown as undefined }}
            >
              {prompt.content}
            </div>
            <div className="pointer-events-none absolute inset-x-0 bottom-0 h-5 bg-gradient-to-t from-white to-transparent dark:from-gray-900" />
          </div>
        </div>
        <button
          className={`p-2 rounded-md hover:bg-gray-100 dark:hover:bg-gray-700 transition ${prompt.isFavorite ? 'text-amber-500' : 'text-gray-500'}`}
          onClick={(e) => { e.stopPropagation(); onToggleFavorite(prompt) }}
          title={prompt.isFavorite ? 'Unfavorite' : 'Favorite'}
          aria-label={prompt.isFavorite ? 'Unfavorite' : 'Favorite'}
        >
          <Star size={18} className="inline" fill={prompt.isFavorite ? 'currentColor' : 'none'} />
        </button>
      </div>

      {prompt.tags?.length ? (
        <div className="flex flex-wrap items-center gap-1 mt-2">
          {prompt.tags.map((tag) => (
            <span
              key={tag}
              className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium ${hashColorFromTag(tag)} max-w-[160px]`}
              title={tag}
            >
              <TagIcon size={10} />
              <span className="truncate break-words">{tag}</span>
            </span>
          ))}
        </div>
      ) : null}

      <div className="mt-3 flex items-center justify-between text-xs text-gray-500 dark:text-gray-400">
        <div>Used {prompt.usageCount ?? 0} times</div>
        <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
          <button className="px-2 py-1 rounded hover:bg-gray-100 dark:hover:bg-gray-700" onClick={() => onEdit(prompt)} title="Edit">
            <Pencil size={14} />
          </button>
          <button
            className="px-2 py-1 rounded hover:bg-gray-100 dark:hover:bg-gray-700"
            onClick={() => setConfirmOpen(true)}
            title="Delete"
          >
            <Trash2 size={14} />
          </button>
          <button
            className={`px-2 py-1 rounded ${canInsert ? 'hover:bg-gray-100 dark:hover:bg-gray-700' : 'opacity-50 cursor-not-allowed'}`}
            onClick={async () => {
              if (!canInsert) return
              if (onSend) await onSend(prompt)
              else await onInsert(prompt)
            }}
            title={canInsert ? 'Insert' : 'Open ChatGPT tab to enable insert'}
            disabled={!canInsert}
          >
            <Send size={14} />
          </button>
        </div>
      </div>
    </div>
    </div>
    <DeleteConfirmModal
      open={confirmOpen}
      title="Delete this prompt?"
      description="This action cannot be undone."
      confirmLabel="Delete"
      onCancel={() => setConfirmOpen(false)}
      onConfirm={() => {
        setConfirmOpen(false)
        onDelete(prompt)
        showToast({ variant: 'success', message: 'Prompt deleted' })
      }}
    />
    </>
  )
}


