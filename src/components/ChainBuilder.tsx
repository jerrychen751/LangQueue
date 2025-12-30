import { useCallback, useEffect, useRef, useState } from 'react'
import { ArrowDown, ArrowUp, Trash2, X, Save, Plus } from 'lucide-react'
import { saveChain } from '../utils/storage'
import { useToast } from './useToast'

type ChainBuilderProps = {
  open: boolean
  onClose: () => void
}

type ChainItem = {
  id: string
  content: string
}

const DEFAULT_STEP_COUNT = 2

function createEmptyItem(): ChainItem {
  return {
    id: `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    content: '',
  }
}

function createDefaultItems(): ChainItem[] {
  return Array.from({ length: DEFAULT_STEP_COUNT }, () => createEmptyItem())
}

export default function ChainBuilder({ open, onClose }: ChainBuilderProps) {
  const dialogRef = useRef<HTMLDivElement | null>(null)
  const lastActiveRef = useRef<HTMLElement | null>(null)

  const [items, setItems] = useState<ChainItem[]>(() => createDefaultItems())
  const [editingId, setEditingId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [title, setTitle] = useState('')
  const { showToast } = useToast()

  const handleClose = useCallback(() => {
    onClose()
    setTimeout(() => lastActiveRef.current?.focus(), 0)
  }, [onClose])

  useEffect(() => {
    if (!open) return
    lastActiveRef.current = (document.activeElement as HTMLElement) ?? null
    // reset transient states when opened
    setSaving(false)
    setTitle('')
    const defaults = createDefaultItems()
    setItems(defaults)
    setEditingId(null)
  }, [open])

  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.stopPropagation()
        handleClose()
      }
      if (e.key === 'Tab' && dialogRef.current) {
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
  }, [open, handleClose])

  function addStep() {
    const next = createEmptyItem()
    setItems((prev) => [...prev, next])
    setEditingId(next.id)
  }

  function updateItem(id: string, content: string) {
    setItems((prev) => prev.map((item) => (item.id === id ? { ...item, content } : item)))
  }

  function removeItem(index: number) {
    setItems((prev) => prev.filter((_, i) => i !== index))
  }

  function moveUp(index: number) {
    if (index <= 0) return
    setItems((prev) => {
      const next = prev.slice()
      const t = next[index - 1]
      next[index - 1] = next[index]
      next[index] = t
      return next
    })
  }

  function moveDown(index: number) {
    if (index >= items.length - 1) return
    setItems((prev) => {
      const next = prev.slice()
      const t = next[index + 1]
      next[index + 1] = next[index]
      next[index] = t
      return next
    })
  }

  const allFilled = items.length > 0 && items.every((it) => it.content.trim().length > 0)
  const canSave = allFilled && title.trim().length > 0 && !saving

  async function handleSaveChain() {
    if (!canSave) return
    setSaving(true)
    try {
      const now = Date.now()
      await saveChain({ id: '', title: title.trim(), steps: items.map((it) => ({ content: it.content.trim() })), createdAt: now, updatedAt: now }, 'local')
      showToast({ variant: 'success', message: 'Chain saved to library' })
      setTitle('')
      handleClose()
    } catch (err) {
      showToast({ variant: 'error', message: err instanceof Error ? err.message : 'Failed to save chain' })
    } finally {
      setSaving(false)
    }
  }

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      aria-hidden={!open}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) handleClose()
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="chain-builder-title"
        className="w-popup max-w-popup bg-white rounded-md shadow-lg border outline-none dark:bg-gray-900 dark:border-gray-700"
      >
        <div className="flex items-center justify-between p-3 border-b">
          <div id="chain-builder-title" className="font-medium text-gray-900 dark:text-gray-100">
            Build Prompt Chain
          </div>
          <button className="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-800" onClick={handleClose} aria-label="Close">
            <X size={16} />
          </button>
        </div>

        <div className="p-3 space-y-3">
          <div className="border rounded-md overflow-hidden">
            <div className="px-3 py-2 text-xs font-medium border-b bg-gray-50 dark:bg-gray-800 dark:text-gray-200">Chain sequence</div>
            <div className="max-h-[360px] overflow-auto">
              {items.length === 0 ? (
                <div className="p-3 text-xs text-gray-500">Add a step to start building a chain.</div>
              ) : (
                <ol className="divide-y">
                  {items.map((it, idx) => {
                    const isEditing = it.content.trim().length === 0 || editingId === it.id
                    return (
                      <li key={it.id} className="px-3 py-2">
                        <div className="flex items-start gap-2">
                          <div className="w-6 shrink-0 text-xs text-gray-500 pt-1">{idx + 1}.</div>
                          <div className="flex-1 min-w-0">
                            {isEditing ? (
                              <textarea
                                value={it.content}
                                placeholder={`Step ${idx + 1} prompt`}
                                onChange={(e) => updateItem(it.id, e.target.value)}
                                onFocus={() => setEditingId(it.id)}
                                onBlur={() => {
                                  if (editingId === it.id) setEditingId(null)
                                }}
                                className="w-full min-h-[64px] resize-none rounded-md border border-gray-200 bg-white px-2 py-2 text-sm text-gray-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-sky-500 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100"
                              />
                            ) : (
                              <button
                                type="button"
                                className="w-full text-left"
                                onClick={() => setEditingId(it.id)}
                                title={it.content}
                              >
                                <div className="text-sm text-gray-900 dark:text-gray-100 truncate">{it.content}</div>
                              </button>
                            )}
                          </div>
                          <div className="flex items-center gap-1 pt-1">
                            <button
                              className="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-50"
                              onClick={() => moveUp(idx)}
                              disabled={idx === 0}
                              aria-label="Move up"
                            >
                              <ArrowUp size={14} />
                            </button>
                            <button
                              className="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-50"
                              onClick={() => moveDown(idx)}
                              disabled={idx === items.length - 1}
                              aria-label="Move down"
                            >
                              <ArrowDown size={14} />
                            </button>
                            <button
                              className="p-1 rounded hover:bg-rose-50 text-rose-700 dark:hover:bg-rose-900/30 dark:text-rose-300"
                              onClick={() => removeItem(idx)}
                              aria-label="Remove"
                            >
                              <Trash2 size={14} />
                            </button>
                          </div>
                        </div>
                      </li>
                    )
                  })}
                </ol>
              )}
            </div>
            <div className="border-t px-3 py-2 bg-gray-50 dark:bg-gray-800">
              <button
                className="inline-flex items-center gap-2 text-xs font-medium text-gray-700 dark:text-gray-200 hover:text-gray-900 dark:hover:text-white"
                onClick={addStep}
                type="button"
              >
                <Plus size={14} /> Add step
              </button>
            </div>
          </div>

          <div className="flex items-center justify-between gap-2">
            <input
              type="text"
              value={title}
              placeholder="Chain title"
              onChange={(e) => setTitle(e.target.value)}
              className="flex-1 px-2 py-1 text-xs border rounded bg-white dark:bg-gray-900 dark:border-gray-700"
            />
            <button
              className="inline-flex items-center gap-2 px-3 py-2 text-sm rounded-xl bg-emerald-600 text-white shadow hover:bg-emerald-700 disabled:opacity-60"
              onClick={handleSaveChain}
              disabled={!canSave}
            >
              <Save size={16} /> Save prompt chain
            </button>
            <button className="px-3 py-2 text-sm rounded-xl bg-white/10 border border-white/15 backdrop-blur-md text-white" onClick={handleClose} disabled={saving}>
              Cancel
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
