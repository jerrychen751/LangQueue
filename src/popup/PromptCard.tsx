import { Pencil, Trash2, Send } from 'lucide-react'
import type { Prompt } from '../types'
import { useToast } from '../components/useToast'
import DeleteConfirmModal from '../components/DeleteConfirmModal'
import { useState } from 'react'

type PromptCardProps = {
  index: number
  prompt: Prompt
  onEdit: (prompt: Prompt) => void
  onDelete: (prompt: Prompt) => void
  onInsert: (prompt: Prompt) => void
  onSend?: (prompt: Prompt) => void
  canInsert?: boolean
}

export function PromptCard({
  index,
  prompt,
  onEdit,
  onDelete,
  onInsert,
  onSend,
  canInsert = true,
}: PromptCardProps) {
  const { showToast } = useToast()
  const [confirmOpen, setConfirmOpen] = useState(false)
  const promptNumber = String(index + 1).padStart(2, '0')

  return (
    <>
      <article
        className="prompt-card"
        data-enabled={canInsert}
      >
        <div className="flex items-start gap-3">
          <button
            type="button"
            className="min-w-0 flex-1 text-left"
            onClick={async () => onInsert(prompt)}
            disabled={!canInsert}
            title={canInsert ? 'Insert prompt' : 'Open ChatGPT, Gemini, or Claude to enable insert'}
            aria-label={`Insert ${prompt.title || 'prompt'}`}
          >
            <div className="prompt-index">PROMPT {promptNumber}</div>
            <div className="prompt-title break-words" title={prompt.title}>
              {prompt.title || 'Untitled'}
            </div>
            <div className="prompt-copy">{prompt.content}</div>
          </button>
          <div
            className="flex items-center gap-1"
          >
            <button
              className="card-action"
              onClick={() => onEdit(prompt)}
              title="Edit prompt"
              aria-label={`Edit ${prompt.title || 'prompt'}`}
            >
              <Pencil size={13} />
            </button>
            <button
              className="card-action"
              onClick={() => setConfirmOpen(true)}
              title="Delete prompt"
              aria-label={`Delete ${prompt.title || 'prompt'}`}
            >
              <Trash2 size={13} />
            </button>
          </div>
        </div>

        <div className="mt-4 flex items-center justify-between border-t border-[#d9dfe1] pt-3">
          <div className="prompt-meta">
            <span>{prompt.usageCount ?? 0} uses</span>
            {(prompt.attachments?.length ?? 0) > 0 ? (
              <>
                <span aria-hidden>•</span>
                <span>{prompt.attachments.length} file{prompt.attachments.length === 1 ? '' : 's'}</span>
              </>
            ) : null}
          </div>
          <button
            className="card-action"
            data-primary="true"
            onClick={async () => {
              if (!canInsert) return
              if (onSend) await onSend(prompt)
              else await onInsert(prompt)
            }}
            title={canInsert ? 'Send prompt' : 'Open a supported chat page to enable send'}
            aria-label={`Send ${prompt.title || 'prompt'}`}
            disabled={!canInsert}
          >
            <Send size={13} />
          </button>
        </div>
      </article>
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
