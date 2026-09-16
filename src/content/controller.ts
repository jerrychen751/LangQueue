import type { Adapter } from './adapters/adapter'
import type { AppSettings, Platform } from '../library/model'
import type { InsertPromptResult, TabRequests } from '../messaging/protocol'
import { listenForRequests, type RequestHandlers } from '../messaging/transport'
import { detectShortcutContext } from './shortcut_trigger'
import { getInputText, setInputText } from './composer/composer_text'
import { insertComposerPrompt } from './composer/insert_prompt'
import { createEditor } from './prompt_editor/prompt_editor'
import { createOverlay } from './prompt_overlay'
import { createQueue } from './execution/queue'
import { createExecutionCoordinator, getConversationHref, isConversationReady } from './execution/step_execution'
import { createQueuePanel } from './execution/status_panel'
import { createChainExecutor } from './execution/chain_executor'
import { applyTweaks } from './page_tweaks'
import { createPrompt, deletePrompt, getSettings, logUsage, searchPrompts, searchChains, updatePrompt } from './library_client'

type InputElement = HTMLTextAreaElement | HTMLElement

function mapPlatform(id: Adapter['id']): Platform {
  return id === 'chatgpt' || id === 'claude' || id === 'gemini' ? id : 'other'
}

export function initController(adapter: Adapter) {
  let settings: AppSettings = {}
  let settingsLoaded = false
  let settingsRequest: Promise<boolean> | null = null
  let settingsVersion = 0
  let settingsErrorShown = false
  let searchErrorShown = false
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
      const chainVersion = item.kind === 'chain' ? chainExecutor.getCancellationVersion() : null
      void (async () => {
        const expectedHref = getConversationHref()
        const expectedInput = adapter.getInputElement()
        const expectedText = expectedInput ? getInputText(expectedInput) : null
        if (!await ensureSettingsLoaded()) return
        if (chainVersion !== null && chainVersion !== chainExecutor.getCancellationVersion()) return
        if (expectedHref !== getConversationHref()) {
          executionPanel.showMessage('The conversation changed while settings loaded. Select the prompt again in the intended conversation.')
          return
        }
        const input = adapter.getInputElement()
        if (!input || input !== expectedInput || getInputText(input) !== expectedText) {
          executionPanel.showMessage('The draft changed while settings loaded. Select the prompt again when ready.')
          return
        }
        if (item.kind === 'prompt') {
          const result = await insertComposerPrompt(adapter, coordinator, item.content,
            settings.multimodalEnabled === false ? [] : item.attachments || [], 'overwrite', false, expectedHref)
          if (!result.ok) {
            // Stop text insertion when the attachment or composer check fails
            executionPanel.showMessage(result.reason || 'Prompt insertion failed. Check the composer before trying again.')
            return
          }
          overlay.hide()
          void logUsage(item.id, mapPlatform(adapter.id)).catch(() => {
            executionPanel.showMessage('The prompt was inserted, but its usage count could not be saved. Do not insert it again just to update the count.')
          })
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
        editor.open({ id: item.id, title: item.title, content: item.content, attachmentCount: item.attachments.length })
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

  function ensureSettingsLoaded(): Promise<boolean> {
    if (settingsLoaded) return Promise.resolve(true)
    if (settingsRequest) return settingsRequest
    const version = settingsVersion
    settingsRequest = (async () => {
      try {
        const next = await getSettings()
        if (version !== settingsVersion) return settingsLoaded
        settings = next
        settingsLoaded = true
        applyTweaks(settings)
        if (settingsErrorShown) executionPanel.showMessage('')
        settingsErrorShown = false
        return true
      } catch (error) {
        if (version === settingsVersion) {
          settingsLoaded = false
          settingsErrorShown = true
          const detail = error instanceof Error ? ` Details: ${error.message}` : ''
          executionPanel.showMessage(`Settings are unavailable. Your draft was kept. Try the action again to reload settings; if it still fails, reload the extension.${detail}`)
        }
        return false
      } finally {
        if (version === settingsVersion) settingsRequest = null
      }
    })()
    return settingsRequest
  }

  function overlayPositionFromRect(rect: DOMRect) {
    return { x: rect.left, top: rect.top, bottom: rect.bottom }
  }

  async function updateShortcutSuggestions() {
    const input = activeInput || adapter.getInputElement()
    if (!input) {
      pendingSearchToken += 1
      overlay.hide()
      return
    }
    const context = detectShortcutContext(input)
    if (!context) {
      pendingSearchToken += 1
      overlay.hide()
      return
    }
    const query = context.query || ''
    const token = ++pendingSearchToken
    try {
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
      if (searchErrorShown) executionPanel.showMessage('')
      searchErrorShown = false
    } catch (error) {
      if (token !== pendingSearchToken) return
      overlay.hide()
      searchErrorShown = true
      const detail = error instanceof Error ? ` Details: ${error.message}` : ''
      executionPanel.showMessage(`The prompt library could not be loaded. Type your shortcut again to retry; if it still fails, reload the extension.${detail}`)
    }
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
      const expectedHref = getConversationHref()
      const queueVersion = queue.getCancellationVersion()
      void ensureSettingsLoaded().then((ready) => {
        if (!ready) return
        if (queueVersion !== queue.getCancellationVersion()) return
        if (getConversationHref() !== expectedHref || adapter.getInputElement() !== input || getInputText(input) !== text) {
          executionPanel.showMessage('The composer changed while settings loaded. Your draft was kept; queue it again when ready.')
          return
        }
        setInputText(input, '')
        if (!queue.enqueue({ content: text })) {
          setInputText(input, text)
          executionPanel.showMessage(queue.getSnapshot().error === 'CONVERSATION_REQUIRED'
            ? 'Start a conversation first, then run the queue or chain. Your draft was kept.'
            : 'Cancellation is still finishing. Your draft is preserved; send it again when cancellation finishes.')
        }
      })
    }
  }

  function handleInput(event: Event) {
    if (!event.isTrusted) return
    const input = getEventInput(event)
    if (!input) return
    void updateShortcutSuggestions()
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

  async function handleInsertRequest({ content, attachments = [], expectedHref }: TabRequests['INJECT_PROMPT']['payload'], shouldSend: boolean): Promise<InsertPromptResult> {
    if (!content && attachments.length === 0) return { ok: false, sendAttempted: false, reason: 'No prompt text or attachments were provided.' }
    const expectedInput = adapter.getInputElement()
    const expectedText = expectedInput ? getInputText(expectedInput) : null
    if (!await ensureSettingsLoaded()) return { ok: false, sendAttempted: false, reason: 'Settings are unavailable. Try the action again to reload settings.' }
    const input = adapter.getInputElement()
    if (input !== expectedInput || (input && getInputText(input) !== expectedText)) return { ok: false, sendAttempted: false, reason: 'The draft changed while settings loaded. Try again when ready.' }
    const mode = settings.insertionMode || 'overwrite'
    const contentWithNL = !content || content.endsWith('\n') ? content || '' : content + '\n'
    return insertComposerPrompt(adapter, coordinator, contentWithNL,
      settings.multimodalEnabled === false ? [] : attachments, mode, shouldSend, expectedHref)
  }

  const requestHandlers: RequestHandlers<TabRequests> = {
    COMPAT_CHECK: async () => ({ ready: Boolean(adapter.getInputElement()) }),
    INJECT_PROMPT: (payload) => handleInsertRequest(payload, false),
    INSERT_AND_SEND_PROMPT: (payload) => handleInsertRequest(payload, true),
    RUN_CHAIN: async ({ steps, expectedHref, insertionModeOverride }) => {
      const chainVersion = chainExecutor.getCancellationVersion()
      if (expectedHref !== getConversationHref()) return { ok: false, reason: 'CONVERSATION_CHANGED' }
      const expectedInput = adapter.getInputElement()
      const expectedText = expectedInput ? getInputText(expectedInput) : null
      if (!await ensureSettingsLoaded()) return { ok: false, reason: 'SETTINGS_UNAVAILABLE' }
      if (chainVersion !== chainExecutor.getCancellationVersion()) return { ok: false, reason: 'CANCELLED' }
      if (expectedHref !== getConversationHref()) return { ok: false, reason: 'CONVERSATION_CHANGED' }
      const input = adapter.getInputElement()
      if (input !== expectedInput || (input && getInputText(input) !== expectedText)) {
        executionPanel.showMessage('The draft changed while settings loaded. Start the chain again when ready.')
        return { ok: false, reason: 'COMPOSER_CHANGED' }
      }
      if (!isConversationReady()) {
        void chainExecutor.run(steps, settings, insertionModeOverride)
        return { ok: false, reason: 'CONVERSATION_REQUIRED' }
      }
      if (coordinator.isBusy()) return { ok: false, reason: 'COMPOSER_BUSY' }
      void chainExecutor.run(steps, settings, insertionModeOverride)
      return { ok: true }
    },
    CANCEL_CHAIN: async () => {
      chainExecutor.cancel()
    },
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
  chrome.runtime.onMessage.addListener(listenForRequests<TabRequests>(requestHandlers))
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return
    if (changes.langqueue_settings) {
      settingsVersion += 1
      settingsLoaded = false
      settingsRequest = null
      void ensureSettingsLoaded()
    }
  })

  refreshInput()
  void ensureSettingsLoaded()
}
