import { useCallback, useEffect, useRef, useState } from 'react'
import { ArrowDown, ArrowUp, Trash2, X, Save, Plus, Paperclip } from 'lucide-react'
import { saveChain } from '../utils/storage'
import { useToast } from './useToast'
import type { AttachmentRef } from '../types'
import { saveAttachmentFile, validateAttachmentFile } from '../utils/attachments'

type ChainBuilderProps = {
  open: boolean
  onClose: () => void
}

type ChainItem = {
  id: string
  content: string
  attachments: AttachmentRef[]
}

const DEFAULT_STEP_COUNT = 2

function createEmptyItem(): ChainItem {
  return {
    id: `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    content: '',
    attachments: [],
  }
}

function createDefaultItems(): ChainItem[] {
  return Array.from({ length: DEFAULT_STEP_COUNT }, () => createEmptyItem())
}

export default function ChainBuilder({ open, onClose }: ChainBuilderProps) {
  const dialogRef = useRef<HTMLDivElement | null>(null)
  const lastActiveRef = useRef<HTMLElement | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  const [items, setItems] = useState<ChainItem[]>(() => createDefaultItems())
  const [editingId, setEditingId] = useState<string | null>(null)
  const [pendingAttachmentStepId, setPendingAttachmentStepId] = useState<string | null>(null)
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
    setPendingAttachmentStepId(null)
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

  function removeAttachment(stepId: string, attachmentId: string) {
    setItems((prev) => prev.map((item) => (
      item.id === stepId
        ? { ...item, attachments: item.attachments.filter((entry) => entry.id !== attachmentId) }
        : item
    )))
  }

  async function addAttachmentsToStep(stepId: string, files: FileList | null) {
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
      setItems((prev) => prev.map((item) => (
        item.id === stepId ? { ...item, attachments: [...item.attachments, ...next] } : item
      )))
      showToast({ variant: 'success', message: `${next.length} attachment${next.length === 1 ? '' : 's'} added` })
    } catch (err) {
      showToast({ variant: 'error', message: err instanceof Error ? err.message : 'Failed to add attachment' })
    } finally {
      setSaving(false)
      setPendingAttachmentStepId(null)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
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
      await saveChain({
        id: '',
        title: title.trim(),
        steps: items.map((it) => ({ content: it.content.trim(), attachments: it.attachments })),
        createdAt: now,
        updatedAt: now,
      })
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
      className="modal-backdrop"
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
        className="modal-surface outline-none"
      >
        <input
          ref={fileInputRef}
          type="file"
          multiple
          className="hidden"
          onChange={(e) => {
            if (!pendingAttachmentStepId) return
            void addAttachmentsToStep(pendingAttachmentStepId, e.target.files)
          }}
        />
        <div className="modal-header">
          <div>
            <div className="popup-kicker">Sequential workflow</div>
            <div id="chain-builder-title" className="modal-title mt-1">
              Build prompt chain
            </div>
          </div>
          <button className="icon-button" onClick={handleClose} aria-label="Close">
            <X size={16} />
          </button>
        </div>

        <div className="space-y-3 p-4">
          <div className="settings-panel">
            <div className="settings-heading border-b border-[#d9dfe1]">Chain sequence</div>
            <div className="max-h-[330px] overflow-auto">
              {items.length === 0 ? (
                <div className="p-4 text-xs text-[#6f7c82]">Add a step to start the chain.</div>
              ) : (
                <ol className="divide-y divide-[#d9dfe1]">
                  {items.map((it, idx) => {
                    const isEditing = it.content.trim().length === 0 || editingId === it.id
                    return (
                      <li key={it.id} className="px-3 py-3">
                        <div className="flex items-start gap-2">
                          <div className="chain-number h-7 w-7">{String(idx + 1).padStart(2, '0')}</div>
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
                                className="form-input min-h-[72px] w-full resize-none rounded-[4px] px-3 py-2 text-sm"
                              />
                            ) : (
                              <button
                                type="button"
                                className="w-full rounded-[3px] px-1 py-1 text-left hover:bg-[#edf2f3]"
                                onClick={() => setEditingId(it.id)}
                                title={it.content}
                              >
                                <div className="truncate text-sm text-[#1c272c]">{it.content}</div>
                              </button>
                            )}
                          </div>
                          <div className="flex items-center gap-1 pt-1">
                            <button
                              className="icon-button h-7 w-7"
                              onClick={() => {
                                setPendingAttachmentStepId(it.id)
                                fileInputRef.current?.click()
                              }}
                              aria-label="Add attachment"
                            >
                              <Paperclip size={14} />
                            </button>
                            <button
                              className="icon-button h-7 w-7 disabled:opacity-30"
                              onClick={() => moveUp(idx)}
                              disabled={idx === 0}
                              aria-label="Move up"
                            >
                              <ArrowUp size={14} />
                            </button>
                            <button
                              className="icon-button h-7 w-7 disabled:opacity-30"
                              onClick={() => moveDown(idx)}
                              disabled={idx === items.length - 1}
                              aria-label="Move down"
                            >
                              <ArrowDown size={14} />
                            </button>
                            <button
                              className="icon-button h-7 w-7 text-rose-700 hover:border-rose-300 hover:bg-rose-50"
                              onClick={() => removeItem(idx)}
                              aria-label="Remove"
                            >
                              <Trash2 size={14} />
                            </button>
                          </div>
                        </div>
                        {it.attachments.length > 0 ? (
                          <div className="ml-9 mt-2 flex flex-wrap gap-1">
                            {it.attachments.map((attachment) => (
                              <span key={attachment.id} className="inline-flex items-center gap-1 rounded-[3px] border border-[#cfd6d8] bg-[#f8f9f9] px-2 py-1 text-[10px]">
                                <span className="max-w-[150px] truncate">{attachment.name}</span>
                                <button
                                  type="button"
                                  className="rounded-[2px] p-0.5 hover:bg-[#e7ecee]"
                                  onClick={() => removeAttachment(it.id, attachment.id)}
                                >
                                  <X size={10} />
                                </button>
                              </span>
                            ))}
                          </div>
                        ) : null}
                      </li>
                    )
                  })}
                </ol>
              )}
            </div>
            <div className="border-t border-[#d9dfe1] px-3 py-2.5">
              <button
                className="compact-button inline-flex items-center gap-2"
                onClick={addStep}
                type="button"
              >
                <Plus size={14} /> Add step
              </button>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <input
              type="text"
              value={title}
              placeholder="Chain title"
              onChange={(e) => setTitle(e.target.value)}
              className="form-input min-w-0 flex-1 rounded-[4px] px-3 py-2.5 text-xs"
            />
            <button
              className="primary-button min-h-10 disabled:opacity-50"
              onClick={handleSaveChain}
              disabled={!canSave}
            >
              <Save size={15} /> Save chain
            </button>
            <button className="secondary-button min-h-10" onClick={handleClose} disabled={saving}>
              Cancel
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
