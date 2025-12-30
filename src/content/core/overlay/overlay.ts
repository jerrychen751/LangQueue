export type OverlayItem =
  | {
      kind: 'prompt'
      id: string
      title: string
      content: string
    }
  | {
      kind: 'chain'
      id: string
      title: string
      steps: { content: string }[]
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
  :host { all: initial; }
  .lq-overlay {
    position: fixed;
    z-index: 2147483647;
    background: #0b1220;
    color: #e5e7eb;
    border: 1px solid #1f2937;
    border-radius: 10px;
    box-shadow: 0 16px 32px rgba(0,0,0,0.35);
    min-width: 280px;
    max-width: 420px;
    font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, "Apple Color Emoji", "Segoe UI Emoji";
  }
  .lq-header {
    padding: 8px 10px;
    font-size: 12px;
    color: #9ca3af;
    border-bottom: 1px solid #1f2937;
  }
  .lq-create {
    margin: 6px 6px 0;
    width: calc(100% - 12px);
    border-radius: 8px;
    border: 1px solid #1f2937;
    background: #111827;
    color: #e5e7eb;
    font-size: 12px;
    padding: 8px 10px;
    cursor: pointer;
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .lq-create:hover {
    background: #0f172a;
  }
  .lq-create svg {
    width: 14px;
    height: 14px;
  }
  .lq-list {
    list-style: none;
    margin: 0;
    padding: 6px;
    display: flex;
    flex-direction: column;
    gap: 2px;
    overflow-y: auto;
    overscroll-behavior: contain;
  }
  .lq-item {
    display: grid;
    grid-template-columns: 1fr auto;
    gap: 8px;
    align-items: center;
    padding: 6px 10px;
    border-radius: 8px;
    cursor: pointer;
  }
  .lq-item.active {
    background: #1f2937;
  }
  .lq-title {
    font-size: 12px;
    font-weight: 600;
    color: #f9fafb;
    line-height: 1.4;
  }
  .lq-edit {
    position: relative;
    background: transparent;
    border: 1px solid #1f2937;
    color: #cbd5f5;
    font-size: 12px;
    width: 24px;
    height: 24px;
    padding: 0;
    border-radius: 6px;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    justify-content: center;
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
    background: #111827;
    color: #e5e7eb;
    border: 1px solid #1f2937;
    border-radius: 6px;
    font-size: 11px;
    padding: 3px 6px;
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
    width: 100%;
    border-radius: 8px;
    border: 1px dashed #1f2937;
    background: transparent;
    padding: 10px 12px;
    font-size: 12px;
    color: #9ca3af;
    display: flex;
    align-items: center;
    justify-content: center;
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
