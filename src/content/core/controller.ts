import type { Adapter } from '../adapters/adapter'
import type { AppSettings, Platform } from '../../types'
import type { ChainStep, KnownMessage } from '../../types/messages'
import { detectSlashContext } from './detect/slash'
import { getInputText, setInputText } from './insert/composer'
import { insertComposerPrompt } from './insert/manual'
import { createEditor } from './editor/editor'
import { createOverlay } from './overlay/overlay'
import { createQueue } from './queue/queue'
import { createExecutionCoordinator, getConversationHref, isConversationReady } from './queue/execution'
import { createQueuePanel } from './queue/panel'
import { createChainExecutor } from './queue/chain_executor'
import { applyTweaks } from './page_tweaks/tweaks'
import { createPrompt, deletePrompt, getSettings, logUsage, searchPrompts, searchChains, updatePrompt } from './messaging'

type InputElement = HTMLTextAreaElement | HTMLElement

function mapPlatform(id: Adapter['id']): Platform {
  return id === 'chatgpt' || id === 'claude' || id === 'gemini' ? id : 'other'
}

export function initController(adapter: Adapter) {
  let settings: AppSettings = {}
  let activeInput: InputElement | null = null
  let pendingSearchToken = 0
  let readySent = false
  let conversationHref = getConversationHref()

  const editor = createEditor({
    onSave: async (draft) => {
      if (draft.id) return updatePrompt(draft.id, draft.title, draft.content)
      return createPrompt(draft.title, draft.content)
    },
    onDelete: async (id) => deletePrompt(id),
  })

  const overlay = createOverlay({
    onSelect: (item) => {
      void (async () => {
        const input = adapter.getInputElement()
        if (!input) return
        if (item.kind === 'prompt') {
          const result = await insertComposerPrompt(adapter, coordinator, item.content,
            settings.multimodalEnabled === false ? [] : item.attachments || [], 'overwrite', false, getConversationHref())
          if (!result.ok) {
            // Stop text insertion when the attachment or composer check fails
            executionPanel.showMessage(result.reason || 'Prompt insertion failed. Check the composer before trying again.')
            return
          }
          overlay.hide()
          void logUsage(item.id, mapPlatform(adapter.id))
          return
        }
        overlay.hide()
        if (chainExecutor.isRunning()) return
        void chainExecutor.run(item.steps, settings, 'overwrite')
      })()
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

  const coordinator = createExecutionCoordinator()
  const queue = createQueue(adapter, () => adapter.getInputElement(), coordinator)
  const chainExecutor = createChainExecutor(adapter, () => adapter.getInputElement(), coordinator)
  const executionPanel = createQueuePanel(queue, chainExecutor)

  function refreshInput() {
    const nextHref = getConversationHref()
    if (nextHref !== conversationHref) {
      conversationHref = nextHref
      queue.stopForNavigation()
      chainExecutor.stopForNavigation()
      overlay.hide()
      pendingSearchToken += 1
    }
    const next = adapter.getInputElement()
    if (next !== activeInput) {
      activeInput = next
      if (next && !readySent) {
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
    const input = activeInput || adapter.getInputElement()
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
        attachments: prompt.attachments || [],
      })),
      ...chains.map((chain) => ({
        kind: 'chain' as const,
        id: chain.id,
        title: chain.title,
        steps: chain.steps,
      })),
    ]
    const label = query ? `$${query}` : ''
    overlay.show(overlayPositionFromRect(context.rect), items, label)
  }

  function getEventInput(event: Event): InputElement | null {
    const target = event.target as Node | null
    if (!target) return null
    const input = activeInput || adapter.getInputElement()
    if (!input) return null
    if (target === input) return input
    if (input instanceof HTMLElement && input.contains(target)) return input
    return null
  }

  function handleKeydown(event: KeyboardEvent) {
    if (!event.isTrusted) return
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
      const text = getInputText(input)
      if (!text.trim()) return
      event.preventDefault()
      setInputText(input, '')
      if (!queue.enqueue({ content: text })) {
        setInputText(input, text)
        executionPanel.showMessage(queue.getSnapshot().error === 'CONVERSATION_REQUIRED'
          ? 'Start a conversation first, then run the queue or chain. Your draft was kept.'
          : 'Cancellation is still finishing. Your draft is preserved; send it again when cancellation finishes.')
      }
    }
  }

  function handleInput(event: Event) {
    if (!event.isTrusted) return
    const input = getEventInput(event)
    if (!input) return
    void updateSlashSuggestions()
  }

  function handleFocus() {
    refreshInput()
  }

  function handlePointerDown(event: MouseEvent) {
    if (!event.isTrusted) return
    if (!overlay.isOpen()) return
    const input = activeInput || adapter.getInputElement()
    const target = event.target as Node | null
    if (input instanceof HTMLElement && target && input.contains(target)) return
    if (overlay.isEventInside(event)) return
    overlay.hide()
  }

  function isInputActive(): boolean {
    const input = activeInput || adapter.getInputElement()
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
      const ready = Boolean(adapter.getInputElement())
      sendResponse({ type: 'COMPAT_STATUS', payload: { ready } })
      return
    }
    if (msg.type === 'INJECT_PROMPT' || msg.type === 'INSERT_AND_SEND_PROMPT') {
      const content = msg.payload?.content
      const attachments = Array.isArray(msg.payload?.attachments) ? msg.payload.attachments : []
      const shouldSend = msg.type === 'INSERT_AND_SEND_PROMPT'
      const resultType = shouldSend ? 'INSERT_AND_SEND_PROMPT_RESULT' : 'INJECT_PROMPT_RESULT'
      if (!content && attachments.length === 0) {
        sendResponse({ type: resultType, payload: { ok: false, sendAttempted: false, reason: 'No prompt text or attachments were provided.' } })
        return
      }
      if (typeof msg.payload.expectedHref !== 'string') {
        sendResponse({ type: resultType, payload: { ok: false, sendAttempted: false, reason: 'The target conversation is missing. Reload the extension and try again.' } })
        return
      }
      const mode = settings.insertionMode || 'overwrite'
      const contentWithNL = !content || content.endsWith('\n') ? content || '' : content + '\n'
      void insertComposerPrompt(adapter, coordinator, contentWithNL,
        settings.multimodalEnabled === false ? [] : attachments, mode, shouldSend, msg.payload.expectedHref)
        .then(result => sendResponse({ type: resultType, payload: result }))
      return true
    }
    if (msg.type === 'RUN_CHAIN') {
      const payload = msg.payload
      if (!payload || !Array.isArray(payload.steps) || payload.steps.length === 0) {
        sendResponse({ ok: false, reason: 'NO_STEPS' })
        return
      }
      if (!isConversationReady()) {
        sendResponse({ ok: false, reason: 'CONVERSATION_REQUIRED' })
        void chainExecutor.run(payload.steps as ChainStep[], settings, payload.insertionModeOverride)
        return
      }
      if (coordinator.isBusy()) {
        sendResponse({ ok: false, reason: 'COMPOSER_BUSY' })
        return
      }
      sendResponse({ ok: true })
      void chainExecutor.run(payload.steps as ChainStep[], settings, payload.insertionModeOverride)
      return
    }
    if (msg.type === 'CANCEL_CHAIN') {
      chainExecutor.cancel()
      sendResponse({ ok: true })
      return
    }
  }

  const observer = new MutationObserver(() => refreshInput())
  observer.observe(document.documentElement, { childList: true, subtree: true })
  window.addEventListener('popstate', refreshInput)
  window.addEventListener('hashchange', refreshInput)
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
