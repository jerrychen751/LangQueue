export type PromptDraft = {
  id?: string
  title: string
  content: string
}

type EditorCallbacks = {
  onSave: (draft: PromptDraft) => Promise<boolean> | boolean
  onDelete: (id: string) => Promise<boolean> | boolean
  onClose?: () => void
}

const STYLES = `
  :host { all: initial; }
  .lq-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0,0,0,0.6);
    z-index: 2147483647;
    display: none;
    align-items: center;
    justify-content: center;
  }
  .lq-modal {
    width: min(720px, 92vw);
    max-height: 88vh;
    background: #15181b;
    color: #e5e7eb;
    border: 1px solid #1f2937;
    border-radius: 14px;
    box-shadow: 0 30px 60px rgba(0,0,0,0.45);
    display: flex;
    flex-direction: column;
    font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, "Apple Color Emoji", "Segoe UI Emoji";
  }
  .lq-modal,
  .lq-modal * {
    box-sizing: border-box;
  }
  .lq-header {
    padding: 16px 18px 10px 18px;
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  .lq-title {
    font-size: 15px;
    letter-spacing: 0.02em;
    color: #d1d5db;
  }
  .lq-close {
    background: transparent;
    border: none;
    color: #9ca3af;
    cursor: pointer;
    font-size: 18px;
    line-height: 1;
    padding: 4px 6px;
    border-radius: 8px;
    transition: background 120ms ease, color 120ms ease, box-shadow 120ms ease;
  }
  .lq-close:hover,
  .lq-close:focus-visible {
    background: #1f2327;
    color: #f3f4f6;
    box-shadow: 0 0 0 2px rgba(148,163,184,0.2);
  }
  .lq-body {
    padding: 6px 18px 16px 18px;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .lq-label {
    font-size: 12px;
    color: #9ca3af;
  }
  .lq-input,
  .lq-textarea {
    width: 100%;
    border-radius: 8px;
    border: 1px solid #2b3138;
    background: #1a1e22;
    color: #e5e7eb;
    padding: 10px 12px;
    font-size: 13px;
    outline: none;
  }
  .lq-input::placeholder,
  .lq-textarea::placeholder {
    color: #6b7280;
  }
  .lq-textarea {
    min-height: 300px;
    resize: vertical;
    line-height: 1.45;
    white-space: pre-wrap;
  }
  .lq-error {
    font-size: 12px;
    color: #f87171;
    min-height: 16px;
  }
  .lq-footer {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 10px;
    padding: 14px 18px 18px 18px;
  }
  .lq-btn {
    border-radius: 10px;
    padding: 8px 14px;
    font-size: 13px;
    border: 1px solid #2b3138;
    cursor: pointer;
    transition: background 120ms ease, border-color 120ms ease, color 120ms ease, box-shadow 120ms ease;
  }
  .lq-btn:focus-visible {
    box-shadow: 0 0 0 2px rgba(148,163,184,0.25);
  }
  .lq-btn-secondary {
    background: #22262a;
    color: #e5e7eb;
  }
  .lq-btn-primary {
    background: #2f3439;
    color: #e5e7eb;
  }
  .lq-btn-secondary:hover:not(:disabled),
  .lq-btn-secondary:focus-visible:not(:disabled) {
    background: #2a2f34;
    border-color: #3b4450;
  }
  .lq-btn-primary:hover:not(:disabled),
  .lq-btn-primary:focus-visible:not(:disabled) {
    background: #3a4046;
    border-color: #4b5563;
  }
  .lq-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  .lq-delete {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 34px;
    height: 34px;
    border-radius: 10px;
    border: 1px solid #2b3138;
    background: #1c2024;
    color: #f87171;
    cursor: pointer;
    transition: background 120ms ease, border-color 120ms ease, color 120ms ease, box-shadow 120ms ease;
  }
  .lq-delete svg {
    width: 16px;
    height: 16px;
  }
  .lq-delete:hover:not(:disabled),
  .lq-delete:focus-visible:not(:disabled) {
    background: #2a2f34;
    border-color: #3b4450;
    color: #fecaca;
    box-shadow: 0 0 0 2px rgba(148,163,184,0.22);
  }
  .lq-delete:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
`

export function createEditor(callbacks: EditorCallbacks) {
  const host = document.createElement('div')
  host.setAttribute('data-langqueue-editor', 'true')
  const shadow = host.attachShadow({ mode: 'open' })
  const style = document.createElement('style')
  style.textContent = STYLES

  const backdrop = document.createElement('div')
  backdrop.className = 'lq-backdrop'
  const modal = document.createElement('div')
  modal.className = 'lq-modal'

  const header = document.createElement('div')
  header.className = 'lq-header'
  const title = document.createElement('div')
  title.className = 'lq-title'
  title.textContent = 'Shortcut'
  const closeBtn = document.createElement('button')
  closeBtn.className = 'lq-close'
  closeBtn.setAttribute('aria-label', 'Close')
  closeBtn.innerHTML = '&times;'
  header.appendChild(title)
  header.appendChild(closeBtn)

  const body = document.createElement('div')
  body.className = 'lq-body'
  const nameLabel = document.createElement('label')
  nameLabel.className = 'lq-label'
  nameLabel.textContent = 'Shortcut name'
  const nameInput = document.createElement('input')
  nameInput.className = 'lq-input'
  nameInput.placeholder = 'Enter a short name'

  const instructionsLabel = document.createElement('label')
  instructionsLabel.className = 'lq-label'
  instructionsLabel.textContent = 'Instructions'
  const instructionsArea = document.createElement('textarea')
  instructionsArea.className = 'lq-textarea'
  instructionsArea.placeholder = 'Write the prompt instructions here'

  const errorEl = document.createElement('div')
  errorEl.className = 'lq-error'

  body.appendChild(nameLabel)
  body.appendChild(nameInput)
  body.appendChild(instructionsLabel)
  body.appendChild(instructionsArea)
  body.appendChild(errorEl)

  const footer = document.createElement('div')
  footer.className = 'lq-footer'
  const deleteBtn = document.createElement('button')
  deleteBtn.className = 'lq-delete'
  deleteBtn.setAttribute('aria-label', 'Delete')
  deleteBtn.innerHTML = `
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path fill="currentColor" d="M9 3h6l1.5 2H20v2H4V5h3.5L9 3zm-2 6h2v10H7V9zm4 0h2v10h-2V9zm4 0h2v10h-2V9z"/>
    </svg>
  `
  const cancelBtn = document.createElement('button')
  cancelBtn.className = 'lq-btn lq-btn-secondary'
  cancelBtn.textContent = 'Cancel'
  const saveBtn = document.createElement('button')
  saveBtn.className = 'lq-btn lq-btn-primary'
  saveBtn.textContent = 'Save'
  footer.appendChild(deleteBtn)
  footer.appendChild(cancelBtn)
  footer.appendChild(saveBtn)

  modal.appendChild(header)
  modal.appendChild(body)
  modal.appendChild(footer)
  backdrop.appendChild(modal)
  shadow.appendChild(style)
  shadow.appendChild(backdrop)
  document.documentElement.appendChild(host)

  let currentId: string | undefined
  let isOpen = false
  let busy = false
  let lastActive: HTMLElement | null = null

  function setBusy(next: boolean) {
    busy = next
    saveBtn.disabled = next
    cancelBtn.disabled = next
    deleteBtn.disabled = next
  }

  function setError(message: string) {
    errorEl.textContent = message
  }

  function resetError() {
    setError('')
  }

  function open(draft: PromptDraft) {
    lastActive = document.activeElement as HTMLElement | null
    currentId = draft.id
    nameInput.value = draft.title || ''
    instructionsArea.value = draft.content || ''
    resetError()
    deleteBtn.style.display = currentId ? 'inline-flex' : 'none'
    backdrop.style.display = 'flex'
    isOpen = true
    setTimeout(() => nameInput.focus(), 0)
  }

  function close() {
    backdrop.style.display = 'none'
    isOpen = false
    callbacks.onClose?.()
    if (lastActive) {
      setTimeout(() => lastActive?.focus(), 0)
    }
  }

  async function handleSave() {
    if (busy) return
    const titleVal = nameInput.value.trim()
    const rawContent = instructionsArea.value
    const trimmedContent = rawContent.trim()
    if (!titleVal) {
      setError('Shortcut name is required.')
      nameInput.focus()
      return
    }
    if (!trimmedContent) {
      setError('Instructions are required.')
      instructionsArea.focus()
      return
    }
    resetError()
    setBusy(true)
    try {
      const ok = await callbacks.onSave({ id: currentId, title: titleVal, content: rawContent })
      if (ok) {
        close()
      } else {
        setError('Failed to save.')
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to save.'
      setError(message)
    } finally {
      setBusy(false)
    }
  }

  async function handleDelete() {
    if (busy || !currentId) return
    const confirmed = window.confirm('Delete this prompt?')
    if (!confirmed) return
    setBusy(true)
    try {
      const ok = await callbacks.onDelete(currentId)
      if (ok) {
        close()
      } else {
        setError('Failed to delete.')
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to delete.'
      setError(message)
    } finally {
      setBusy(false)
    }
  }

  function handleKeydown(event: KeyboardEvent) {
    if (!isOpen) return
    if (event.key === 'Escape') {
      event.preventDefault()
      close()
    }
    if ((event.key === 'Enter' || event.key === 'NumpadEnter') && (event.metaKey || event.ctrlKey)) {
      event.preventDefault()
      void handleSave()
    }
  }

  closeBtn.addEventListener('click', () => close())
  cancelBtn.addEventListener('click', () => close())
  saveBtn.addEventListener('click', () => void handleSave())
  deleteBtn.addEventListener('click', () => void handleDelete())
  backdrop.addEventListener('mousedown', (event) => {
    if (event.target === backdrop) close()
  })
  document.addEventListener('keydown', handleKeydown, true)

  return {
    open,
    close,
    isOpen: () => isOpen,
  }
}
