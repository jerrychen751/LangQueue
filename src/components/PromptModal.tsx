import { useEffect, useRef, useState, useCallback } from 'react'
import { X, Loader2 } from 'lucide-react'
import type { Prompt } from '../types'
import { savePrompt, updatePrompt, type StorageArea } from '../utils/storage'
import { useToast } from './useToast'

type PromptModalProps = {
  open: boolean
  initialPrompt?: Prompt
  storageArea?: StorageArea
  onClose: () => void
  onSaved?: (saved: Prompt) => void
}

function generateClientId(): string {
  return `p_${Date.now()}_${Math.random().toString(36).slice(2)}`
}

export default function PromptModal({ open, initialPrompt, storageArea = 'local', onClose, onSaved }: PromptModalProps) {
  const isEditing = Boolean(initialPrompt)
  const titleRef = useRef<HTMLInputElement | null>(null)
  const dialogRef = useRef<HTMLDivElement | null>(null)
  const lastActiveRef = useRef<HTMLElement | null>(null)
  const contentRef = useRef<HTMLTextAreaElement | null>(null)
  const { showToast } = useToast()

  const [title, setTitle] = useState(initialPrompt?.title ?? '')
  const [content, setContent] = useState(initialPrompt?.content ?? '')
  const [description, setDescription] = useState(initialPrompt?.description ?? '')
  const [tagInput, setTagInput] = useState('')
  const [tags, setTags] = useState<string[]>(initialPrompt?.tags ?? [])
  const [category, setCategory] = useState(initialPrompt?.category ?? '')
  const [isFavorite, setIsFavorite] = useState<boolean>(initialPrompt?.isFavorite ?? false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    lastActiveRef.current = (document.activeElement as HTMLElement) ?? null
    // Reset fields when opening for a different prompt
    setTitle(initialPrompt?.title ?? '')
    setContent(initialPrompt?.content ?? '')
    setDescription(initialPrompt?.description ?? '')
    setTags(initialPrompt?.tags ?? [])
    setCategory(initialPrompt?.category ?? '')
    setIsFavorite(initialPrompt?.isFavorite ?? false)
    setTagInput('')
    setError(null)
    // Focus the title
    setTimeout(() => titleRef.current?.focus(), 0)
  }, [open, initialPrompt])

  const close = useCallback(() => {
    onClose()
    // Restore focus
    setTimeout(() => lastActiveRef.current?.focus(), 0)
  }, [onClose])

  const handleSave = useCallback(async () => {
    // Read latest values from DOM refs to avoid stale state when saving via hotkeys
    const t = (titleRef.current?.value ?? title).trim()
    const c = (contentRef.current?.value ?? content).trim()
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
    if (!c) {
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
          content: c,
          description: description.trim(),
          tags,
          category: category.trim(),
          isFavorite,
        }, storageArea)
        const saved: Prompt = {
          ...initialPrompt,
          title: t,
          content: c,
          description: description.trim(),
          tags,
          category: category.trim(),
          isFavorite,
          updatedAt: Date.now(),
        }
        onSaved?.(saved)
        close()
      } else {
        const now = Date.now()
        const newPrompt: Prompt = {
          id: generateClientId(),
          title: t,
          content: c,
          description: description.trim(),
          category: category.trim(),
          tags,
          isFavorite,
          usageCount: 0,
          createdAt: now,
          updatedAt: now,
        }
        await savePrompt(newPrompt, storageArea)
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
  }, [category, close, content, description, initialPrompt, isEditing, isFavorite, onSaved, storageArea, showToast, tags, title])

  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.stopPropagation()
        close()
      }
      // Global save shortcut: Cmd/Ctrl + Shift + Enter
      if ((e.key === 'Enter' || e.key === 'NumpadEnter') && e.shiftKey && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        e.stopPropagation()
        // Trigger save regardless of focused field
        if (!saving) {
          // Call asynchronously to avoid re-entrancy in key handler
          Promise.resolve().then(() => handleSave())
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
  }, [open, close, saving, handleSave])

  function addTagFromInput() {
    const t = tagInput.trim()
    if (!t) return
    if (!tags.includes(t)) setTags((prev) => [...prev, t])
    setTagInput('')
  }

  function removeTag(tag: string) {
    setTags((prev) => prev.filter((t) => t !== tag))
  }

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
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
        className="w-popup max-w-popup bg-white rounded-md shadow-lg border outline-none dark:bg-gray-900 dark:border-gray-700"
      >
        <div className="flex items-center justify-between p-3 border-b">
          <div id="prompt-modal-title" className="font-medium text-gray-900 dark:text-gray-100">
            {isEditing ? 'Edit Prompt' : 'New Prompt'}
          </div>
          <button className="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-800" onClick={close} aria-label="Close">
            <X size={16} />
          </button>
        </div>

        <div className="p-3 space-y-3">
          {error ? (
            <div className="text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded px-2 py-1 dark:text-rose-200 dark:bg-rose-900/30 dark:border-rose-800" role="alert">
              {error}
            </div>
          ) : null}

          <div>
            <label className="block text-xs text-gray-700 mb-1 dark:text-gray-300">Title</label>
            <input
              ref={titleRef}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full px-2 py-2 text-sm border rounded-md focus:outline-none focus:ring-2 focus:ring-sky-300 bg-white dark:bg-gray-800 dark:text-gray-100 dark:border-gray-700"
              placeholder="Enter a clear, descriptive title"
            />
          </div>

          <div>
            <label className="block text-xs text-gray-700 mb-1 dark:text-gray-300">Content</label>
            <textarea
              ref={contentRef}
              value={content}
              onChange={(e) => setContent(e.target.value)}
              className="w-full px-2 py-2 text-sm border rounded-md focus:outline-none focus:ring-2 focus:ring-sky-300 min-h-[96px] bg-white dark:bg-gray-800 dark:text-gray-100 dark:border-gray-700"
              rows={4}
              placeholder="Your prompt content..."
            />
          </div>

          <div>
            <label className="block text-xs text-gray-700 mb-1 dark:text-gray-300">Description (optional)</label>
            <input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full px-2 py-2 text-sm border rounded-md focus:outline-none focus:ring-2 focus:ring-sky-300 bg-white dark:bg-gray-800 dark:text-gray-100 dark:border-gray-700"
              placeholder="Short description for this prompt"
            />
          </div>

          <div>
            <label className="block text-xs text-gray-700 mb-1 dark:text-gray-300">Tags</label>
            <div className="flex flex-wrap gap-1 mb-1">
              {tags.map((t) => (
                <span key={t} className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-200 border dark:border-gray-700">
                  {t}
                  <button className="ml-1 text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200" onClick={() => removeTag(t)} aria-label={`Remove ${t}`}>
                    ×
                  </button>
                </span>
              ))}
            </div>
            <input
              value={tagInput}
              onChange={(e) => setTagInput(e.target.value)}
              onBlur={addTagFromInput}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ',') {
                  e.preventDefault()
                  addTagFromInput()
                }
              }}
              className="w-full px-2 py-2 text-sm border rounded-md focus:outline-none focus:ring-2 focus:ring-sky-300 bg-white dark:bg-gray-800 dark:text-gray-100 dark:border-gray-700"
              placeholder="Type a tag and press Enter"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-gray-700 mb-1 dark:text-gray-300">Category</label>
              <input
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className="w-full px-2 py-2 text-sm border rounded-md focus:outline-none focus:ring-2 focus:ring-sky-300 bg-white dark:bg-gray-800 dark:text-gray-100 dark:border-gray-700"
                placeholder="e.g., Research, Coding, Content"
              />
            </div>
            <div className="flex items-end">
              <label className="inline-flex items-center gap-2 text-sm px-2 py-1 rounded-md bg-white/5 border border-white/10 backdrop-blur-sm">
                <input
                  type="checkbox"
                  className="h-4 w-4 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 accent-amber-500"
                  checked={isFavorite}
                  onChange={(e) => setIsFavorite(e.target.checked)}
                />
                Favorite
              </label>
            </div>
          </div>
        </div>

        <div className="flex items-center justify-between gap-2 p-3 border-t">
          <div className="text-[11px] text-gray-500 dark:text-gray-400">
            Tip: Press <span className="font-medium">{navigator.platform.includes('Mac') ? 'Cmd' : 'Ctrl'} + Shift + Enter</span> to save
          </div>
          <button className="px-3 py-2 text-sm rounded-xl bg-white/10 border border-white/15 backdrop-blur-md text-white hover:bg-white/15" onClick={close} disabled={saving}>
            Cancel
          </button>
          <button
            className="inline-flex items-center gap-2 px-3 py-2 text-sm rounded-xl bg-white/10 border border-white/15 backdrop-blur-md text-white shadow-lg shadow-sky-500/10 hover:bg-white/15 disabled:opacity-60"
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


