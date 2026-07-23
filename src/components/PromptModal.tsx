import { useEffect, useRef, useState } from 'react'
import { X, Loader2, Paperclip, Trash2 } from 'lucide-react'
import type { AttachmentRef, Prompt } from '../types'
import { savePrompt, updatePrompt } from '../utils/storage'
import { useToast } from './useToast'
import { saveAttachmentFile, validateAttachmentFile } from '../utils/attachments'

type PromptModalProps = {
  open: boolean
  initialPrompt?: Prompt
  onClose: () => void
  onSaved?: (saved: Prompt) => void
}

function generateClientId(): string {
  return `p_${Date.now()}_${Math.random().toString(36).slice(2)}`
}

export default function PromptModal({ open, initialPrompt, onClose, onSaved }: PromptModalProps) {
  const isEditing = Boolean(initialPrompt)
  const titleRef = useRef<HTMLInputElement | null>(null)
  const dialogRef = useRef<HTMLDivElement | null>(null)
  const lastActiveRef = useRef<HTMLElement | null>(null)
  const contentRef = useRef<HTMLTextAreaElement | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const savingRef = useRef(false)
  const handleSaveRef = useRef<() => Promise<void>>(async () => {})
  const { showToast } = useToast()

  const [title, setTitle] = useState(initialPrompt?.title ?? '')
  const [content, setContent] = useState(initialPrompt?.content ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [attachments, setAttachments] = useState<AttachmentRef[]>(initialPrompt?.attachments ?? [])

  useEffect(() => {
    if (!open) return
    lastActiveRef.current = (document.activeElement as HTMLElement) ?? null
    // Reset fields when opening for a different prompt
    setTitle(initialPrompt?.title ?? '')
    setContent(initialPrompt?.content ?? '')
    setAttachments(initialPrompt?.attachments ?? [])
    setError(null)
    // Focus the title
    setTimeout(() => titleRef.current?.focus(), 0)
  }, [open, initialPrompt])

  useEffect(() => {
    savingRef.current = saving
  }, [saving])

  function close() {
    onClose()
    // Restore focus
    setTimeout(() => lastActiveRef.current?.focus(), 0)
  }

  async function handleFilesPicked(files: FileList | null) {
    if (!files || files.length === 0) return
    setSaving(true)
    try {
      const next: AttachmentRef[] = []
      for (const file of Array.from(files)) {
        const validation = validateAttachmentFile(file)
        if (validation) throw new Error(`${file.name}: ${validation}`)
        const saved = await saveAttachmentFile(file)
        next.push(saved)
      }
      setAttachments((prev) => [...prev, ...next])
      showToast({ variant: 'success', message: `${next.length} attachment${next.length === 1 ? '' : 's'} added` })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add attachment.')
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = ''
      setSaving(false)
    }
  }

  function removeAttachment(id: string) {
    setAttachments((prev) => prev.filter((item) => item.id !== id))
  }

  async function handleSave() {
    // Read latest values from DOM refs to avoid stale state when saving via hotkeys
    const t = (titleRef.current?.value ?? title).trim()
    const rawContent = contentRef.current?.value ?? content
    const trimmedContent = rawContent.trim()
    if (!t) {
      setError('Title is required.')
      titleRef.current?.focus()
      return
    }
    if (t.length < 3) {
      setError('Title must be at least 3 characters.')
      titleRef.current?.focus()
      return
    }
    if (!trimmedContent) {
      setError('Content is required.')
      contentRef.current?.focus()
      return
    }
    setSaving(true)
    setError(null)
    try {
      if (isEditing && initialPrompt) {
        await updatePrompt(initialPrompt.id, {
          title: t,
          content: rawContent,
          attachments,
        })
        const saved: Prompt = {
          ...initialPrompt,
          title: t,
          content: rawContent,
          attachments,
          updatedAt: Date.now(),
        }
        onSaved?.(saved)
        close()
      } else {
        const now = Date.now()
        const newPrompt: Prompt = {
          id: generateClientId(),
          title: t,
          content: rawContent,
          attachments,
          usageCount: 0,
          createdAt: now,
          updatedAt: now,
        }
        await savePrompt(newPrompt)
        onSaved?.(newPrompt)
        showToast({ variant: 'success', message: 'Prompt saved' })
        close()
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to save prompt.'
      setError(message)
    } finally {
      setSaving(false)
    }
  }

  handleSaveRef.current = handleSave

  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
      }
      // Global save shortcut: Cmd/Ctrl + Shift + Enter
      if ((e.key === 'Enter' || e.key === 'NumpadEnter') && e.shiftKey && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        e.stopPropagation()
        // Trigger save regardless of focused field
        if (!savingRef.current) {
          // Call asynchronously to avoid re-entrancy in key handler
          Promise.resolve().then(() => handleSaveRef.current())
        }
      }
      if (e.key === 'Tab' && dialogRef.current) {
        // Simple focus trap
        const focusable = dialogRef.current.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
        )
        if (focusable.length === 0) return
        const first = focusable[0]
        const last = focusable[focusable.length - 1]
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault()
          last.focus()
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault()
          first.focus()
        }
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [open, onClose])

  if (!open) return null

  return (
    <div
      className="modal-backdrop"
      aria-hidden={!open}
      onMouseDown={(e) => {
        // Close when clicking the backdrop (overlay) area only
        if (e.target === e.currentTarget) close()
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="prompt-modal-title"
        className="modal-surface outline-none"
      >
        <div className="modal-header">
          <div>
            <div className="popup-kicker">{isEditing ? 'Revise library item' : 'Add library item'}</div>
            <div id="prompt-modal-title" className="modal-title mt-1">
              {isEditing ? 'Edit prompt' : 'New prompt'}
            </div>
          </div>
          <button className="icon-button" onClick={close} aria-label="Close">
            <X size={16} />
          </button>
        </div>

        <div className="space-y-4 p-4">
          {error ? (
            <div className="rounded-[4px] border border-rose-300 bg-rose-50 px-3 py-2 text-xs text-rose-700" role="alert">
              {error}
            </div>
          ) : null}

          <div>
            <label className="field-label">Title</label>
            <input
              ref={titleRef}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="form-input w-full rounded-[4px] px-3 py-2.5 text-sm"
              placeholder="Enter a clear, descriptive title"
            />
          </div>

          <div>
            <label className="field-label">Prompt content</label>
            <textarea
              ref={contentRef}
              value={content}
              onChange={(e) => setContent(e.target.value)}
              className="form-input min-h-[120px] w-full resize-none rounded-[4px] px-3 py-2.5 text-sm leading-6"
              rows={4}
              placeholder="Write the prompt that you want to reuse."
            />
          </div>

          <div>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              className="hidden"
              onChange={(e) => {
                void handleFilesPicked(e.target.files)
              }}
            />
            <div className="mb-2 flex items-center justify-between">
              <label className="field-label mb-0">Attachments</label>
              <button
                type="button"
                className="compact-button inline-flex items-center gap-1.5"
                onClick={() => fileInputRef.current?.click()}
                disabled={saving}
              >
                <Paperclip size={12} />
                Add files
              </button>
            </div>
            {attachments.length === 0 ? (
              <div className="rounded-[4px] border border-dashed border-[#bdc7ca] px-3 py-3 text-[11px] text-[#6f7c82]">No attachments selected.</div>
            ) : (
              <ul className="max-h-24 space-y-1.5 overflow-auto">
                {attachments.map((attachment) => (
                  <li key={attachment.id} className="flex items-center justify-between gap-2 rounded-[4px] border border-[#cfd6d8] bg-[#f8f9f9] px-3 py-2 text-[11px]">
                    <div className="min-w-0">
                      <div className="truncate">{attachment.name}</div>
                      <div className="mt-0.5 text-[9px] text-[#6f7c82]">{Math.ceil(attachment.size / 1024)} KB</div>
                    </div>
                    <button
                      type="button"
                      className="icon-button h-7 w-7"
                      onClick={() => removeAttachment(attachment.id)}
                      aria-label={`Remove ${attachment.name}`}
                    >
                      <Trash2 size={12} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

        </div>

        <div className="flex items-center gap-2 border-t border-[#d9dfe1] p-4">
          <div className="mr-auto text-[10px] text-[#6f7c82]">
            <span className="font-mono">{navigator.platform.includes('Mac') ? '⌘' : 'Ctrl'} + Shift + Enter</span>
          </div>
          <button className="secondary-button min-h-10" onClick={close} disabled={saving}>
            Cancel
          </button>
          <button
            className="primary-button min-h-10"
            onClick={handleSave}
            disabled={saving}
          >
            {saving ? <Loader2 size={16} className="animate-spin" /> : null}
            Save
          </button>
        </div>
      </div>
    </div>
  )
}
