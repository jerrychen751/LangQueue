import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowDown, ArrowUp, Play, Trash2, X } from 'lucide-react'
import type { Prompt } from '../types'
import type { ChainStep } from '../types/messages'

type ChainBuilderProps = {
  open: boolean
  availablePrompts: Prompt[]
  onClose: () => void
  onRunChain: (steps: ChainStep[], insertionMode: 'overwrite' | 'append') => void
}

type ChainItem = {
  id: string
  title: string
  content: string
  autoSend: boolean
  awaitResponse: boolean
  delayMs: number
}

export default function ChainBuilder({ open, availablePrompts, onClose, onRunChain }: ChainBuilderProps) {
  const dialogRef = useRef<HTMLDivElement | null>(null)
  const lastActiveRef = useRef<HTMLElement | null>(null)

  const [insertionMode, setInsertionMode] = useState<'overwrite' | 'append'>('overwrite')
  const [items, setItems] = useState<ChainItem[]>([])
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (!open) return
    lastActiveRef.current = (document.activeElement as HTMLElement) ?? null
    // reset transient states when opened
    setSubmitting(false)
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
  }, [open])

  function handleClose() {
    onClose()
    setTimeout(() => lastActiveRef.current?.focus(), 0)
  }

  function addPromptToChain(p: Prompt) {
    const item: ChainItem = {
      id: `${p.id}_${Date.now()}`,
      title: p.title,
      content: p.content,
      autoSend: true,
      awaitResponse: true,
      delayMs: 0,
    }
    setItems((prev) => [...prev, item])
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

  function updateItem(index: number, changes: Partial<Pick<ChainItem, 'autoSend' | 'awaitResponse' | 'delayMs'>>) {
    setItems((prev) => prev.map((it, i) => (i === index ? { ...it, ...changes } : it)))
  }

  const canRun = items.length > 0 && !submitting

  const sortedPrompts = useMemo(() => {
    return [...availablePrompts].sort((a, b) => a.title.localeCompare(b.title))
  }, [availablePrompts])

  function handleRun() {
    if (!canRun) return
    setSubmitting(true)
    const steps: ChainStep[] = items.map((it) => ({
      content: it.content,
      autoSend: it.autoSend,
      awaitResponse: it.awaitResponse,
      delayMs: it.delayMs,
    }))
    try {
      onRunChain(steps, insertionMode)
      handleClose()
    } finally {
      setSubmitting(false)
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

        <div className="p-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="border rounded-md overflow-hidden">
              <div className="px-3 py-2 text-xs font-medium border-b bg-gray-50 dark:bg-gray-800 dark:text-gray-200">Available prompts</div>
              <div className="max-h-[360px] overflow-auto">
                {sortedPrompts.length === 0 ? (
                  <div className="p-3 text-xs text-gray-500">No prompts yet.</div>
                ) : (
                  <ul className="divide-y">
                    {sortedPrompts.map((p) => (
                      <li key={p.id} className="px-3 py-2 text-sm hover:bg-gray-50 dark:hover:bg-gray-800 cursor-pointer" onClick={() => addPromptToChain(p)}>
                        <div className="font-medium text-gray-900 dark:text-gray-100">{p.title}</div>
                        {p.description ? (
                          <div className="text-[11px] text-gray-500 line-clamp-1">{p.description}</div>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>

            <div className="border rounded-md overflow-hidden">
              <div className="px-3 py-2 text-xs font-medium border-b bg-gray-50 dark:bg-gray-800 dark:text-gray-200">Chain sequence</div>
              <div className="max-h-[360px] overflow-auto">
                {items.length === 0 ? (
                  <div className="p-3 text-xs text-gray-500">Click prompts on the left to add steps.</div>
                ) : (
                  <ol className="divide-y">
                    {items.map((it, idx) => (
                      <li key={it.id} className="px-3 py-2">
                        <div className="flex items-start gap-2">
                          <div className="w-6 shrink-0 text-xs text-gray-500 pt-0.5">{idx + 1}.</div>
                          <div className="flex-1">
                            <div className="flex items-center justify-between gap-2">
                              <div className="font-medium text-gray-900 dark:text-gray-100">{it.title}</div>
                              <div className="flex items-center gap-1">
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

                            <div className="mt-2 grid grid-cols-3 gap-2 text-xs">
                              <label className="inline-flex items-center gap-2 px-2 py-1 rounded border bg-white dark:bg-gray-900 dark:border-gray-700">
                                <input
                                  type="checkbox"
                                  className="h-4 w-4 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 accent-amber-500"
                                  checked={it.autoSend}
                                  onChange={(e) => updateItem(idx, { autoSend: e.target.checked })}
                                />
                                Auto-send
                              </label>
                              <label className="inline-flex items-center gap-2 px-2 py-1 rounded border bg-white dark:bg-gray-900 dark:border-gray-700">
                                <input
                                  type="checkbox"
                                  className="h-4 w-4 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 accent-amber-500"
                                  checked={it.awaitResponse}
                                  onChange={(e) => updateItem(idx, { awaitResponse: e.target.checked })}
                                />
                                Await response
                              </label>
                              <label className="inline-flex items-center gap-2 px-2 py-1 rounded border bg-white dark:bg-gray-900 dark:border-gray-700">
                                <span>Delay (ms)</span>
                                <input
                                  type="number"
                                  min={0}
                                  value={it.delayMs}
                                  onChange={(e) => updateItem(idx, { delayMs: Math.max(0, Number(e.target.value || 0)) })}
                                  className="w-24 px-2 py-1 text-xs border rounded bg-white dark:bg-gray-900 dark:border-gray-700"
                                />
                              </label>
                            </div>
                          </div>
                        </div>
                      </li>
                    ))}
                  </ol>
                )}
              </div>
            </div>
          </div>

          <div className="mt-3 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <label className="text-xs text-gray-700 dark:text-gray-300">Insertion mode</label>
              <select
                value={insertionMode}
                onChange={(e) => setInsertionMode((e.target.value as 'overwrite' | 'append') ?? 'overwrite')}
                className="px-2 py-1 text-xs border rounded bg-white dark:bg-gray-900 dark:border-gray-700"
              >
                <option value="overwrite">overwrite</option>
                <option value="append">append</option>
              </select>
            </div>
            <div className="flex items-center gap-2">
              <button className="px-3 py-2 text-sm rounded-xl bg-white/10 border border-white/15 backdrop-blur-md text-white" onClick={handleClose} disabled={submitting}>
                Cancel
              </button>
              <button
                className="inline-flex items-center gap-2 px-3 py-2 text-sm rounded-xl bg-emerald-600 text-white shadow hover:bg-emerald-700 disabled:opacity-60"
                onClick={handleRun}
                disabled={!canRun}
              >
                <Play size={16} />
                Run Chain
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}


