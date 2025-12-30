import type { Adapter, InputElement } from './types'
import type { AppSettings, Platform } from '../../types'
import type { ChainStep, KnownMessage } from '../../types/messages'
import { detectSlashContext } from './detect/slash'
import { appendInputText, getInputText, setInputText } from './insert/composer'
import { createEditor } from './editor/editor'
import { createOverlay } from './overlay/overlay'
import { createQueue } from './queue/queue'
import { createChainExecutor } from './queue/chain_executor'
import { applyTweaks } from './page_tweaks/tweaks'
import { createPrompt, deletePrompt, getSettings, logUsage, searchPrompts, searchChains, updatePrompt } from './messaging'

function mapPlatform(id: Adapter['id']): Platform {
  return id === 'chatgpt' || id === 'claude' || id === 'gemini' ? id : 'other'
}

export function initController(adapter: Adapter) {
  let settings: AppSettings = {}
  let activeInput: InputElement | null = null
  let pendingSearchToken = 0
  let readySent = false

  const editor = createEditor({
    onSave: async (draft) => {
      if (draft.id) return updatePrompt(draft.id, draft.title, draft.content)
      return createPrompt(draft.title, draft.content)
    },
    onDelete: async (id) => deletePrompt(id),
  })

  const overlay = createOverlay({
    onSelect: (item) => {
      const input = activeInput || adapter.findInput()
      if (!input) return
      if (item.kind === 'prompt') {
        setInputText(input, item.content)
        overlay.hide()
        void logUsage(item.id, mapPlatform(adapter.id))
        return
      }
      overlay.hide()
      if (chainExecutor.isRunning()) return
      void chainExecutor.run(item.steps, settings, 'overwrite')
    },
    onEdit: (item) => {
      overlay.hide()
      if (item.kind === 'prompt') {
        editor.open({ id: item.id, title: item.title, content: item.content })
      }
    },
    onCreate: () => {
      overlay.hide()
      editor.open({ title: '', content: '' })
    },
    onClose: () => {
      pendingSearchToken += 1
    },
  })

  const queue = createQueue(adapter, () => activeInput)
  const chainExecutor = createChainExecutor(adapter, () => activeInput)

  function refreshInput() {
    const next = adapter.findInput()
    if (next && next !== activeInput) {
      activeInput = next
      if (!readySent) {
        readySent = true
        chrome.runtime.sendMessage({ type: 'TEXTAREA_READY' })
      }
    }
  }

  async function updateSettings() {
    settings = await getSettings()
    applyTweaks(settings)
  }

  function overlayPositionFromRect(rect: DOMRect) {
    return { x: rect.left, top: rect.top, bottom: rect.bottom }
  }

  async function updateSlashSuggestions() {
    const input = activeInput || adapter.findInput()
    if (!input) {
      pendingSearchToken += 1
      overlay.hide()
      return
    }
    const context = detectSlashContext(input)
    if (!context) {
      pendingSearchToken += 1
      overlay.hide()
      return
    }
    const query = context.query || ''
    const token = ++pendingSearchToken
    const [prompts, chains] = await Promise.all([
      searchPrompts(query),
      searchChains(query),
    ])
    if (token !== pendingSearchToken) return
    const items = [
      ...prompts.map((prompt) => ({
        kind: 'prompt' as const,
        id: prompt.id,
        title: prompt.title,
        content: prompt.content,
      })),
      ...chains.map((chain) => ({
        kind: 'chain' as const,
        id: chain.id,
        title: chain.title,
        steps: chain.steps,
      })),
    ]
    const label = query ? `//${query}` : ''
    overlay.show(overlayPositionFromRect(context.rect), items, label)
  }

  function getEventInput(event: Event): InputElement | null {
    const target = event.target as Node | null
    if (!target) return null
    const input = activeInput || adapter.findInput()
    if (!input) return null
    if (target === input) return input
    if (input instanceof HTMLElement && input.contains(target)) return input
    return null
  }

  function handleKeydown(event: KeyboardEvent) {
    if (overlay.isOpen()) {
      if (event.key === 'ArrowDown') {
        overlay.moveSelection(1)
        event.preventDefault()
        return
      }
      if (event.key === 'ArrowUp') {
        overlay.moveSelection(-1)
        event.preventDefault()
        return
      }
      if (event.key === 'Tab' || event.key === 'Enter') {
        overlay.selectCurrent()
        event.preventDefault()
        return
      }
      if (event.key === 'Escape') {
        overlay.hide()
        event.preventDefault()
        return
      }
    }

    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
      const input = getEventInput(event)
      if (!input) return
      if (!adapter.isGenerating()) return
      const text = getInputText(input).trim()
      if (!text) return
      event.preventDefault()
      setInputText(input, '')
      queue.enqueue({ content: text })
    }
  }

  function handleInput(event: Event) {
    const input = getEventInput(event)
    if (!input) return
    void updateSlashSuggestions()
  }

  function handleFocus() {
    refreshInput()
  }

  function handlePointerDown(event: MouseEvent) {
    if (!overlay.isOpen()) return
    const input = activeInput || adapter.findInput()
    const target = event.target as Node | null
    if (input instanceof HTMLElement && target && input.contains(target)) return
    if (overlay.isEventInside(event)) return
    overlay.hide()
  }

  function isInputActive(): boolean {
    const input = activeInput || adapter.findInput()
    if (!input) return false
    const active = document.activeElement as Node | null
    if (!active) return false
    if (active === input) return true
    if (input instanceof HTMLElement && input.contains(active)) return true
    return false
  }

  function handleFocusOut(event: FocusEvent) {
    if (!overlay.isOpen()) return
    const related = event.relatedTarget as Node | null
    if (overlay.isNodeInside(related)) return
    setTimeout(() => {
      if (!overlay.isOpen()) return
      if (isInputActive()) return
      const active = document.activeElement as Node | null
      if (overlay.isNodeInside(active)) return
      overlay.hide()
    }, 0)
  }

  function handleMessage(message: unknown, _sender: chrome.runtime.MessageSender, sendResponse: (res?: unknown) => void) {
    if (!message || typeof message !== 'object' || !('type' in message)) return
    const msg = message as KnownMessage
    if (msg.type === 'COMPAT_CHECK') {
      const ready = Boolean(adapter.findInput())
      sendResponse({ type: 'COMPAT_STATUS', payload: { ready } })
      return
    }
    if (msg.type === 'CLICK_SEND') {
      const input = activeInput || adapter.findInput()
      adapter.clickSend(input)
      return
    }
    if (msg.type === 'INJECT_PROMPT') {
      const content = msg.payload?.content
      if (!content) {
        sendResponse({ type: 'INJECT_PROMPT_RESULT', payload: { ok: false, reason: 'NO_CONTENT' } })
        return
      }
      const input = activeInput || adapter.findInput()
      if (!input) {
        sendResponse({ type: 'INJECT_PROMPT_RESULT', payload: { ok: false, reason: 'INPUT_NOT_FOUND' } })
        return
      }
      const mode = settings.insertionMode || 'overwrite'
      const contentWithNL = content.endsWith('\n') ? content : `${content}\n`
      try {
        if (mode === 'append') {
          appendInputText(input, contentWithNL)
        } else {
          setInputText(input, contentWithNL)
        }
        sendResponse({ type: 'INJECT_PROMPT_RESULT', payload: { ok: true } })
      } catch {
        sendResponse({ type: 'INJECT_PROMPT_RESULT', payload: { ok: false, reason: 'INJECTION_FAILED' } })
      }
      return
    }
    if (msg.type === 'RUN_CHAIN') {
      const payload = msg.payload
      if (!payload || !Array.isArray(payload.steps) || payload.steps.length === 0) {
        sendResponse({ ok: false, reason: 'NO_STEPS' })
        return
      }
      if (chainExecutor.isRunning()) {
        sendResponse({ ok: false, reason: 'ALREADY_RUNNING' })
        return
      }
      sendResponse({ ok: true })
      void chainExecutor.run(payload.steps as ChainStep[], settings, payload.insertionModeOverride)
      return
    }
    if (msg.type === 'CANCEL_CHAIN') {
      chainExecutor.cancel()
      chrome.runtime.sendMessage({ type: 'CHAIN_PROGRESS', payload: { stepIndex: 0, totalSteps: 0, status: 'cancelled' } })
      return
    }
  }

  const observer = new MutationObserver(() => refreshInput())
  observer.observe(document.documentElement, { childList: true, subtree: true })
  document.addEventListener('input', handleInput, true)
  document.addEventListener('keydown', handleKeydown, true)
  document.addEventListener('focusin', handleFocus, true)
  document.addEventListener('focusout', handleFocusOut, true)
  document.addEventListener('mousedown', handlePointerDown, true)
  chrome.runtime.onMessage.addListener(handleMessage)
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return
    if (changes.langqueue_settings) {
      settings = changes.langqueue_settings.newValue || {}
      applyTweaks(settings)
    }
  })

  refreshInput()
  void updateSettings()
}
