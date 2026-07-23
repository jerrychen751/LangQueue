import type { AttachmentRef } from '../../../types'
import type { ChainStep } from '../../../types/messages'

export type OverlayItem =
  | {
      kind: 'prompt'
      id: string
      title: string
      content: string
      attachments: AttachmentRef[]
    }
  | {
      kind: 'chain'
      id: string
      title: string
      steps: ChainStep[]
    }

type OverlayCallbacks = {
  onSelect: (item: OverlayItem) => void
  onEdit: (item: OverlayItem) => void
  onClose: () => void
  onCreate: () => void
}

type OverlayState = {
  items: OverlayItem[]
  selectedIndex: number
}

const MAX_VISIBLE_RESULTS = 6

const STYLES = `
  :host {
    all: initial;
    --lq-shell: #f2f4f3;
    --lq-surface: #ffffff;
    --lq-text: #1c272c;
    --lq-text-soft: #46555c;
    --lq-text-muted: #6f7c82;
    --lq-line: #cfd6d8;
    --lq-accent: #527d8c;
    --lq-accent-hover: #426c7a;
    --lq-accent-text: #f7fafb;
  }
  .lq-overlay {
    position: fixed;
    z-index: 2147483647;
    min-width: 300px;
    max-width: 420px;
    overflow: hidden;
    border: 1px solid var(--lq-line);
    border-radius: 6px;
    color: var(--lq-text);
    background: var(--lq-shell);
    box-shadow: 0 16px 40px rgba(28, 39, 44, 0.18), 0 1px 3px rgba(20, 32, 37, 0.1);
    color-scheme: light;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  }
  .lq-overlay,
  .lq-overlay * {
    box-sizing: border-box;
  }
  .lq-header {
    padding: 10px 12px 9px;
    border-bottom: 1px solid #d9dfe1;
    color: var(--lq-text-muted);
    background: #fbfcfc;
    font-size: 9.5px;
    font-weight: 600;
    letter-spacing: 0.09em;
    text-transform: uppercase;
  }
  .lq-create {
    display: flex;
    width: calc(100% - 16px);
    align-items: center;
    gap: 6px;
    margin: 8px 8px 2px;
    padding: 8px 10px;
    border: 1px solid var(--lq-line);
    border-radius: 4px;
    color: var(--lq-text-soft);
    background: var(--lq-surface);
    font: inherit;
    font-size: 11px;
    font-weight: 600;
    cursor: pointer;
    transition: border-color 140ms ease, color 140ms ease, background 140ms ease;
  }
  .lq-create:hover {
    border-color: #9eb1b8;
    color: var(--lq-accent-hover);
    background: #edf2f3;
  }
  .lq-create:focus-visible,
  .lq-edit:focus-visible {
    outline: 2px solid var(--lq-accent);
    outline-offset: 2px;
  }
  .lq-create svg {
    width: 14px;
    height: 14px;
    flex: 0 0 auto;
  }
  .lq-list {
    display: flex;
    flex-direction: column;
    gap: 4px;
    margin: 0;
    padding: 6px 8px 8px;
    overflow-y: auto;
    list-style: none;
    overscroll-behavior: contain;
    scrollbar-color: rgba(95, 110, 117, 0.3) transparent;
    scrollbar-width: thin;
  }
  .lq-item {
    display: grid;
    grid-template-columns: 1fr auto;
    align-items: center;
    gap: 8px;
    padding: 8px 8px 8px 10px;
    border: 1px solid transparent;
    border-left: 3px solid transparent;
    border-radius: 5px;
    background: var(--lq-surface);
    box-shadow: 0 1px 2px rgba(20, 32, 37, 0.06);
    cursor: pointer;
    transition: border-color 140ms ease, background 140ms ease, box-shadow 140ms ease;
  }
  .lq-item:hover {
    border-color: #d9dfe1;
    border-left-color: #9eb1b8;
    background: #f8f9f9;
  }
  .lq-item.active {
    border-color: #b8c8ce;
    border-left-color: var(--lq-accent);
    background: #eef3f5;
    box-shadow: 0 2px 5px rgba(20, 32, 37, 0.08);
  }
  .lq-title {
    overflow: hidden;
    color: var(--lq-text);
    font-size: 12.5px;
    font-weight: 650;
    line-height: 1.4;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .lq-edit {
    position: relative;
    display: inline-flex;
    height: 24px;
    width: 24px;
    align-items: center;
    justify-content: center;
    padding: 0;
    border: 1px solid var(--lq-line);
    border-radius: 3px;
    color: var(--lq-text-muted);
    background: var(--lq-surface);
    font: inherit;
    font-size: 12px;
    cursor: pointer;
    transition: border-color 140ms ease, color 140ms ease, background 140ms ease;
  }
  .lq-edit:hover {
    border-color: var(--lq-accent);
    color: var(--lq-accent-text);
    background: var(--lq-accent);
  }
  .lq-edit svg {
    width: 14px;
    height: 14px;
    display: block;
  }
  .lq-edit .lq-tooltip {
    position: absolute;
    top: -28px;
    right: 0;
    padding: 3px 6px;
    border: 1px solid var(--lq-text);
    border-radius: 4px;
    color: var(--lq-accent-text);
    background: var(--lq-text);
    box-shadow: 0 3px 8px rgba(20, 32, 37, 0.16);
    font-size: 11px;
    white-space: nowrap;
    opacity: 0;
    transform: translateY(4px);
    pointer-events: none;
    transition: opacity 120ms ease, transform 120ms ease;
  }
  .lq-edit:hover .lq-tooltip {
    opacity: 1;
    transform: translateY(0);
  }
  .lq-empty {
    display: flex;
    width: 100%;
    align-items: center;
    justify-content: center;
    padding: 10px 12px;
    border: 1px dashed #b8c8ce;
    border-radius: 5px;
    color: var(--lq-text-muted);
    background: var(--lq-surface);
    font-size: 12px;
  }
`

export function createOverlay(callbacks: OverlayCallbacks) {
  const host = document.createElement('div')
  host.setAttribute('data-langqueue-overlay', 'true')
  const shadow = host.attachShadow({ mode: 'open' })
  const style = document.createElement('style')
  style.textContent = STYLES
  const container = document.createElement('div')
  container.className = 'lq-overlay'
  container.style.display = 'none'
  const header = document.createElement('div')
  header.className = 'lq-header'
  const createButton = document.createElement('button')
  createButton.className = 'lq-create'
  createButton.type = 'button'
  createButton.setAttribute('aria-label', 'Create new shortcut')
  createButton.dataset.action = 'create'
  createButton.innerHTML = `
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path fill="currentColor" d="M11 5h2v14h-2zM5 11h14v2H5z"/>
    </svg>
    <span>Create new shortcut</span>
  `
  createButton.addEventListener('click', () => callbacks.onCreate())
  const list = document.createElement('ul')
  list.className = 'lq-list'
  container.appendChild(header)
  container.appendChild(createButton)
  container.appendChild(list)
  shadow.appendChild(style)
  shadow.appendChild(container)
  document.documentElement.appendChild(host)

  const state: OverlayState = { items: [], selectedIndex: 0 }

  function applyScrollLimit() {
    list.style.maxHeight = ''
    list.style.overflowY = state.items.length > MAX_VISIBLE_RESULTS ? 'auto' : 'hidden'
    if (state.items.length <= MAX_VISIBLE_RESULTS) return
    const items = Array.from(list.querySelectorAll('li'))
    if (!items.length) return
    const count = Math.min(MAX_VISIBLE_RESULTS, items.length)
    const style = window.getComputedStyle(list)
    const gapValue = parseFloat(style.rowGap || style.gap || '0')
    const paddingTop = parseFloat(style.paddingTop || '0')
    const paddingBottom = parseFloat(style.paddingBottom || '0')
    let height = paddingTop + paddingBottom
    for (let i = 0; i < count; i += 1) {
      height += items[i].getBoundingClientRect().height
      if (i < count - 1) height += gapValue
    }
    list.style.maxHeight = `${Math.ceil(height)}px`
  }

  function render() {
    list.innerHTML = ''
    if (state.items.length === 0) {
      const empty = document.createElement('li')
      empty.className = 'lq-empty'
      empty.textContent = 'No shortcuts found.'
      list.appendChild(empty)
      applyScrollLimit()
      return
    }
    state.items.forEach((item, index) => {
      const li = document.createElement('li')
      li.className = `lq-item${index === state.selectedIndex ? ' active' : ''}`
      li.dataset.index = String(index)
      const textWrap = document.createElement('div')
      const title = document.createElement('div')
      title.className = 'lq-title'
      title.textContent = item.title || 'Untitled'
      textWrap.appendChild(title)
      function selectItem() {
        state.selectedIndex = index
        callbacks.onSelect(item)
      }
      li.addEventListener('mousedown', (event) => {
        if (event.button !== 0) return
        const target = event.target as HTMLElement | null
        if (target?.closest('button[data-action="edit"]')) return
        selectItem()
      })
      li.addEventListener('click', () => {
        selectItem()
      })
      li.appendChild(textWrap)
      if (item.kind === 'prompt') {
        const edit = document.createElement('button')
        edit.className = 'lq-edit'
        edit.setAttribute('aria-label', 'Edit')
        edit.dataset.action = 'edit'
        edit.innerHTML = `
          <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <path fill="currentColor" d="M3 17.25V21h3.75L17.8 9.94l-3.75-3.75L3 17.25zm2.92 2.33H5v-.92l8.06-8.06.92.92L5.92 19.58zM20.71 6.04a1.003 1.003 0 0 0 0-1.42l-1.34-1.34a1.003 1.003 0 0 0-1.42 0l-1.02 1.02 2.75 2.75 1.03-1.01z"/>
          </svg>
          <span class="lq-tooltip">Edit</span>
        `
        edit.addEventListener('click', (event) => {
          event.stopPropagation()
          state.selectedIndex = index
          callbacks.onEdit(item)
        })
        edit.addEventListener('mousedown', (event) => {
          event.stopPropagation()
        })
        li.appendChild(edit)
      }
      list.appendChild(li)
    })
    applyScrollLimit()
    if (state.items.length > MAX_VISIBLE_RESULTS) {
      const active = list.querySelector('li.active') as HTMLElement | null
      active?.scrollIntoView({ block: 'nearest' })
    }
  }

  function show(position: { x: number; top: number; bottom: number }, items: OverlayItem[], label: string) {
    state.items = items
    state.selectedIndex = Math.min(state.selectedIndex, Math.max(0, items.length - 1))
    header.textContent = label
    header.style.display = label ? 'block' : 'none'
    container.style.display = 'block'
    container.style.visibility = 'hidden'
    list.scrollTop = 0
    render()
    container.style.left = `${Math.max(8, position.x)}px`
    container.style.top = '0px'
    const height = container.getBoundingClientRect().height
    const aboveTop = position.top - height - 8
    const nextTop = aboveTop >= 8 ? aboveTop : position.bottom + 8
    container.style.top = `${Math.max(8, nextTop)}px`
    container.style.visibility = 'visible'
  }

  function hide() {
    container.style.display = 'none'
    state.items = []
    state.selectedIndex = 0
    callbacks.onClose()
  }

  function isOpen() {
    return container.style.display !== 'none'
  }

  function isEventInside(event: Event): boolean {
    const path = event.composedPath ? event.composedPath() : []
    if (path.length > 0) {
      return path.includes(host)
    }
    const target = event.target as Node | null
    return Boolean(target && host.contains(target))
  }

  function isNodeInside(node: Node | null): boolean {
    if (!node) return false
    if (node === host) return true
    if (host.contains(node)) return true
    if (shadow.contains(node)) return true
    const root = node.getRootNode ? node.getRootNode() : null
    return root === shadow
  }

  function moveSelection(delta: number) {
    if (!state.items.length) return
    const max = state.items.length - 1
    state.selectedIndex = Math.max(0, Math.min(max, state.selectedIndex + delta))
    render()
  }

  function selectCurrent() {
    const item = state.items[state.selectedIndex]
    if (item) callbacks.onSelect(item)
  }

  function getSelected() {
    return state.items[state.selectedIndex]
  }

  return {
    show,
    hide,
    isOpen,
    isEventInside,
    isNodeInside,
    moveSelection,
    selectCurrent,
    getSelected,
  }
}
