(() => {
  // Keep message type local to avoid import issues in content script bundling
  type ChainStep = {
    content: string
    autoSend?: boolean
    awaitResponse?: boolean
    delayMs?: number
  }

  type KnownMessage =
    | { type: 'INJECT_PROMPT'; payload: { content: string } }
    | { type: 'COMPAT_CHECK' }
    | { type: 'OPEN_POPUP' }
    | { type: 'TEXTAREA_READY' }
    | { type: 'RUN_CHAIN'; payload: { steps: ChainStep[]; insertionModeOverride?: 'overwrite' | 'append' } }
    | { type: 'CANCEL_CHAIN' }
    | { type: 'INJECT_PROMPT_RESULT'; payload: { ok: boolean; reason?: string } }
    | { type: 'INJECT_PROMPT_ERROR'; payload: { reason: string } }
    | { type: 'COMPAT_STATUS'; payload: { ready: boolean } }

  const scriptMark = '__langqueue_gemini_content__'
  if ((window as unknown as Record<string, unknown>)[scriptMark]) return
  ;(window as unknown as Record<string, unknown>)[scriptMark] = true

  // Gemini uses a contenteditable div as the input in most cases
  const SELECTOR = 'div[contenteditable="true"][role="textbox"], textarea'
  let inputEl: HTMLTextAreaElement | HTMLElement | null = null
  let isChainRunning = false
  let currentChainAborted = false

  function isVisible(el: Element): boolean {
    const htmlEl = el as HTMLElement
    if (!htmlEl) return false
    if (htmlEl.offsetParent !== null) return true
    return htmlEl.getClientRects().length > 0
  }

  function findInput(): HTMLTextAreaElement | HTMLElement | null {
    const el = document.querySelector(SELECTOR) as HTMLElement | null
    if (!el) return null
    if (el.tagName === 'TEXTAREA') return el as HTMLTextAreaElement
    if (el.getAttribute('contenteditable') === 'true') return el
    return null
  }

  function dispatchReady() {
    if (inputEl) {
      chrome.runtime.sendMessage({ type: 'TEXTAREA_READY' })
    }
  }

  // Removed floating action button per product direction

  function showConfirmation(message: string) {
    if (!inputEl) return
    const container = inputEl.closest('div') || inputEl.parentElement || document.body
    if (container && container !== document.body) {
      container.style.position = container.style.position || 'relative'
    }
    const el = document.createElement('div')
    el.textContent = message
    el.style.position = container === document.body ? 'fixed' : 'absolute'
    el.style.right = '10px'
    el.style.bottom = container === document.body ? '56px' : '44px'
    el.style.zIndex = '2147483647'
    el.style.padding = '6px 10px'
    el.style.borderRadius = '9999px'
    el.style.fontSize = '12px'
    el.style.color = '#065f46'
    el.style.background = '#d1fae5'
    el.style.border = '1px solid rgba(5,150,105,0.2)'
    el.style.boxShadow = '0 2px 8px rgba(0,0,0,0.08)'
    el.style.opacity = '0'
    el.style.transform = 'translateY(6px)'
    el.style.transition = 'opacity 150ms ease, transform 150ms ease'
    ;(container || document.body).appendChild(el)
    requestAnimationFrame(() => {
      el.style.opacity = '1'
      el.style.transform = 'translateY(0)'
    })
    setTimeout(() => {
      el.style.opacity = '0'
      el.style.transform = 'translateY(6px)'
      setTimeout(() => el.remove(), 180)
    }, 1200)
  }

  function setTextareaValue(el: HTMLTextAreaElement, value: string) {
    const nativeSetter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
    nativeSetter?.call(el, value)
    const ev = new Event('input', { bubbles: true })
    el.dispatchEvent(ev)
    el.focus()
  }

  function setContentEditableValue(el: HTMLElement, value: string) {
    el.focus()
    // Select all existing content then insert text to trigger frameworks' listeners
    const selection = window.getSelection()
    if (selection) {
      const range = document.createRange()
      range.selectNodeContents(el)
      selection.removeAllRanges()
      selection.addRange(range)
    }
    document.execCommand('insertText', false, value)
    el.dispatchEvent(new Event('input', { bubbles: true }))
  }

  function appendToContentEditable(el: HTMLElement, value: string) {
    el.focus()
    const selection = window.getSelection()
    if (selection) {
      const range = document.createRange()
      range.selectNodeContents(el)
      range.collapse(false) // place caret at end
      selection.removeAllRanges()
      selection.addRange(range)
    }
    const needsNewline = (el.textContent || '').length > 0
    const textToInsert = `${needsNewline ? '\n' : ''}${value}`
    document.execCommand('insertText', false, textToInsert)
    el.dispatchEvent(new Event('input', { bubbles: true }))
  }

  function getInputText(el: HTMLTextAreaElement | HTMLElement | null): string {
    if (!el) return ''
    if (el instanceof HTMLTextAreaElement) return el.value || ''
    return el.textContent || ''
  }

  function isButtonEnabledAndVisible(btn: Element | null): btn is HTMLButtonElement {
    if (!btn) return false
    if (!(btn instanceof HTMLButtonElement)) return false
    if (btn.disabled) return false
    const ariaDisabled = btn.getAttribute('aria-disabled')
    if (ariaDisabled && ariaDisabled.toLowerCase() === 'true') return false
    return isVisible(btn)
  }

  function dispatchEnterOn(el: HTMLElement) {
    el.focus()
    const down = new KeyboardEvent('keydown', {
      key: 'Enter',
      code: 'Enter',
      keyCode: 13,
      which: 13,
      bubbles: true
    } as unknown as KeyboardEventInit)
    const up = new KeyboardEvent('keyup', {
      key: 'Enter',
      code: 'Enter',
      keyCode: 13,
      which: 13,
      bubbles: true
    } as unknown as KeyboardEventInit)
    el.dispatchEvent(down)
    el.dispatchEvent(up)
  }

  function clickSendButton(): boolean {
    if (!inputEl || !(inputEl as HTMLElement).isConnected || !isVisible(inputEl as HTMLElement)) {
      inputEl = findInput()
    }

    const text = getInputText(inputEl).trim()
    if (!text) return false

    const selectors = [
      'button[aria-label="Send message"]',
      'button[aria-label*="Send" i]',
      'button.send-button',
      'button[type="submit"]',
      'form button[type="submit"]',
      'form [type="submit"]'
    ]

    for (const selector of selectors) {
      const candidate = document.querySelector(selector)
      if (isButtonEnabledAndVisible(candidate)) {
        try {
          candidate.click()
          return true
        } catch {
          continue
        }
      }
    }

    const form = (inputEl as HTMLElement | null)?.closest('form')
    if (form) {
      const withinForm = Array.from(form.querySelectorAll('button, [type="submit"]')) as HTMLElement[]
      const btn = withinForm.find((el) => el.tagName === 'BUTTON' && isButtonEnabledAndVisible(el as HTMLButtonElement)) as HTMLButtonElement | undefined
      if (btn) {
        try {
          btn.click()
          return true
        } catch {
          void 0
        }
      }
    }

    if (inputEl && isVisible(inputEl as HTMLElement)) {
      dispatchEnterOn(inputEl as HTMLElement)
      return true
    }

    return false
  }

  function anyVisible(selectors: string[]): boolean {
    for (const selector of selectors) {
      const el = document.querySelector(selector)
      if (el && isVisible(el)) return true
    }
    return false
  }

  function isGeneratingNow(): boolean {
    const stopSelectors = [
      'button[aria-label="Stop"]',
      'button[aria-label*="Stop" i]',
      'button[aria-label*="Cancel" i]'
    ]
    const spinnerSelectors = [
      '[class*="spinner" i]',
      '[class*="loading" i]',
      '[class*="generating" i]',
      '[role="progressbar"]'
    ]
    if (anyVisible(stopSelectors)) return true
    if (anyVisible(spinnerSelectors)) return true

    // If send button disabled while text present, likely generating
    const sendBtn = document.querySelector('button[aria-label*="Send" i], button[type="submit"]') as HTMLButtonElement | null
    if (sendBtn && isVisible(sendBtn)) {
      const ariaDisabled = sendBtn.getAttribute('aria-disabled')
      const disabledLike = sendBtn.disabled || (ariaDisabled && ariaDisabled.toLowerCase() === 'true')
      if (disabledLike && getInputText(inputEl).trim().length > 0) return true
    }
    return false
  }

  async function awaitResponseComplete(options?: { timeoutMs?: number; pollMs?: number }): Promise<boolean> {
    const timeoutMs = options?.timeoutMs ?? 120000
    const pollMs = options?.pollMs ?? 200
    const start = Date.now()

    if (!inputEl || !(inputEl as HTMLElement).isConnected) {
      inputEl = findInput()
    }

    // Phase 1: wait until generation starts (or timeout)
    while (Date.now() - start < timeoutMs) {
      if (isGeneratingNow()) break
      await new Promise((r) => setTimeout(r, pollMs))
    }

    // Phase 2: wait until generation finishes (no stop button/spinner and input re-enabled)
    while (Date.now() - start < timeoutMs) {
      const stillGenerating = isGeneratingNow()
      const inputReady = (() => {
        const el = inputEl as HTMLElement | null
        if (!el) return false
        const ariaDisabled = el.getAttribute('aria-disabled')
        const ce = el.getAttribute('contenteditable')
        const busy = el.getAttribute('aria-busy')
        return isVisible(el) && (!ariaDisabled || ariaDisabled.toLowerCase() !== 'true') && (ce !== 'false') && (!busy || busy.toLowerCase() !== 'true')
      })()
      if (!stillGenerating && inputReady) return true
      await new Promise((r) => setTimeout(r, pollMs))
    }
    return false
  }
  async function injectPrompt(content: string) {
    if (!inputEl) {
      inputEl = findInput()
    }
    if (!inputEl) {
      chrome.runtime.sendMessage({ type: 'INJECT_PROMPT_ERROR', payload: { reason: 'TEXTAREA_NOT_FOUND' } })
      return { ok: false as const, reason: 'TEXTAREA_NOT_FOUND' as const }
    }
    try {
      const settings = await new Promise<{ insertionMode?: 'overwrite' | 'append' }>((resolve) => {
        chrome.storage.local.get(['langqueue_settings'], (res) => resolve(res['langqueue_settings'] || {}))
      })
      const mode = settings.insertionMode || 'overwrite'
      if (inputEl instanceof HTMLTextAreaElement) {
        const base = mode === 'append' && inputEl.value ? `${inputEl.value}\n${content}` : content
        setTextareaValue(inputEl, base)
      } else {
        if (mode === 'append') {
          appendToContentEditable(inputEl, content)
        } else {
          setContentEditableValue(inputEl, content)
        }
      }
      showConfirmation('Inserted')
      return { ok: true as const }
    } catch {
      return { ok: false as const, reason: 'UNKNOWN' as const }
    }
  }

  // Chain orchestration
  async function executeChain(steps: ChainStep[], insertionModeOverride?: 'overwrite' | 'append'): Promise<boolean> {
    const settings = await new Promise<{ insertionMode?: 'overwrite' | 'append'; chainDefaults?: { autoSend?: boolean; awaitResponse?: boolean; defaultDelayMs?: number } }>((resolve) => {
      chrome.storage.local.get(['langqueue_settings'], (res) => resolve((res['langqueue_settings'] as unknown as { insertionMode?: 'overwrite' | 'append'; chainDefaults?: { autoSend?: boolean; awaitResponse?: boolean; defaultDelayMs?: number } }) || {}))
    })

    const totalSteps = steps.length
    chrome.runtime.sendMessage({ type: 'CHAIN_PROGRESS', payload: { stepIndex: 0, totalSteps, status: 'starting' } })

    for (let i = 0; i < steps.length; i++) {
      const step = steps[i]
      if (currentChainAborted) {
        chrome.runtime.sendMessage({ type: 'CHAIN_PROGRESS', payload: { stepIndex: i, totalSteps, status: 'cancelled' } })
        return false
      }

      // Ensure input element is present
      if (!inputEl || !(inputEl as HTMLElement).isConnected || !isVisible(inputEl as HTMLElement)) {
        inputEl = findInput()
      }
      const targetInput = inputEl
      if (!targetInput) {
        chrome.runtime.sendMessage({ type: 'CHAIN_PROGRESS', payload: { stepIndex: i, totalSteps, status: 'error', error: 'TEXTAREA_NOT_FOUND' } })
        return false
      }

      // Determine insertion mode
      const mode = insertionModeOverride || settings.insertionMode || 'overwrite'
      try {
        if (targetInput instanceof HTMLTextAreaElement) {
          const base = mode === 'append' && targetInput.value ? `${targetInput.value}\n${step.content}` : step.content
          setTextareaValue(targetInput, base)
        } else {
          if (mode === 'append') {
            appendToContentEditable(targetInput, step.content)
          } else {
            setContentEditableValue(targetInput, step.content)
          }
        }
      } catch {
        chrome.runtime.sendMessage({ type: 'CHAIN_PROGRESS', payload: { stepIndex: i, totalSteps, status: 'error', error: 'INJECTION_FAILED' } })
        return false
      }

      const defaults = settings.chainDefaults || {}
      const shouldAutoSend = typeof step.autoSend === 'boolean' ? step.autoSend : (typeof defaults.autoSend === 'boolean' ? defaults.autoSend : true)
      const shouldAwait = typeof step.awaitResponse === 'boolean' ? step.awaitResponse : (typeof defaults.awaitResponse === 'boolean' ? defaults.awaitResponse : true)
      const delayMs = typeof step.delayMs === 'number' ? step.delayMs : (typeof defaults.defaultDelayMs === 'number' ? defaults.defaultDelayMs : 0)

      if (currentChainAborted) {
        chrome.runtime.sendMessage({ type: 'CHAIN_PROGRESS', payload: { stepIndex: i, totalSteps, status: 'cancelled' } })
        return false
      }

      if (shouldAutoSend) {
        chrome.runtime.sendMessage({ type: 'CHAIN_PROGRESS', payload: { stepIndex: i, totalSteps, status: 'sending' } })
        try {
          const clicked = clickSendButton()
          if (!clicked) {
            chrome.runtime.sendMessage({ type: 'CHAIN_PROGRESS', payload: { stepIndex: i, totalSteps, status: 'error', error: 'SEND_FAILED' } })
            return false
          }
        } catch {
          chrome.runtime.sendMessage({ type: 'CHAIN_PROGRESS', payload: { stepIndex: i, totalSteps, status: 'error', error: 'SEND_EXCEPTION' } })
          return false
        }

        if (shouldAwait) {
          chrome.runtime.sendMessage({ type: 'CHAIN_PROGRESS', payload: { stepIndex: i, totalSteps, status: 'awaiting_response' } })
          await awaitResponseComplete({ timeoutMs: 120000, pollMs: 200 })
          if (currentChainAborted) {
            chrome.runtime.sendMessage({ type: 'CHAIN_PROGRESS', payload: { stepIndex: i, totalSteps, status: 'cancelled' } })
            return false
          }
        }
      }

      if (delayMs > 0) {
        chrome.runtime.sendMessage({ type: 'CHAIN_PROGRESS', payload: { stepIndex: i, totalSteps, status: 'delayed' } })
        await new Promise((r) => setTimeout(r, delayMs))
      }
    }

    chrome.runtime.sendMessage({ type: 'CHAIN_PROGRESS', payload: { stepIndex: steps.length - 1, totalSteps: steps.length, status: 'completed' } })
    return true
  }

  function isKnownMessage(msg: unknown): msg is KnownMessage {
    return typeof msg === 'object' && msg !== null && 'type' in (msg as Record<string, unknown>)
  }

  function handleMessage(message: unknown, _sender: chrome.runtime.MessageSender, sendResponse: (res?: unknown) => void) {
    if (!isKnownMessage(message)) return
    if (message.type === 'INJECT_PROMPT' && (message as Extract<KnownMessage, { type: 'INJECT_PROMPT' }>).payload?.content) {
      const payload = (message as Extract<KnownMessage, { type: 'INJECT_PROMPT' }>).payload
      injectPrompt(payload.content).then((r) => {
        if (!r) return sendResponse({ type: 'INJECT_PROMPT_RESULT', payload: { ok: false } })
        if (r.ok) return sendResponse({ type: 'INJECT_PROMPT_RESULT', payload: { ok: true } })
        return sendResponse({ type: 'INJECT_PROMPT_RESULT', payload: { ok: false, reason: r.reason } })
      })
      return true
    }
    if (message.type === 'COMPAT_CHECK') {
      const ready = Boolean(findInput())
      sendResponse({ type: 'COMPAT_STATUS', payload: { ready } })
    }
    if (message.type === 'RUN_CHAIN') {
      const payload = (message as Extract<KnownMessage, { type: 'RUN_CHAIN' }>).payload
      if (!payload || !Array.isArray(payload.steps) || payload.steps.length === 0) {
        chrome.runtime.sendMessage({ type: 'CHAIN_PROGRESS', payload: { stepIndex: 0, totalSteps: 0, status: 'error', error: 'NO_STEPS' } })
        return
      }
      if (isChainRunning) {
        chrome.runtime.sendMessage({ type: 'CHAIN_PROGRESS', payload: { stepIndex: 0, totalSteps: payload.steps.length, status: 'error', error: 'ALREADY_RUNNING' } })
        return
      }
      isChainRunning = true
      currentChainAborted = false
      executeChain(payload.steps, payload.insertionModeOverride).finally(() => {
        isChainRunning = false
      })
    }
    if (message.type === 'CANCEL_CHAIN') {
      currentChainAborted = true
      chrome.runtime.sendMessage({ type: 'CHAIN_PROGRESS', payload: { stepIndex: 0, totalSteps: 0, status: 'cancelled' } })
    }
  }

  function scan() {
    const el = findInput()
    if (el && el !== inputEl) {
      inputEl = el
      dispatchReady()
    }
  }

  const observer = new MutationObserver(() => scan())
  observer.observe(document.documentElement, { childList: true, subtree: true })
  scan()

  chrome.runtime.onMessage.addListener(handleMessage)
  window.addEventListener('load', scan)

  ;(window as unknown as Record<string, unknown>).langqueueClickSendButton = clickSendButton
  ;(window as unknown as Record<string, unknown>).langqueueAwaitResponseComplete = awaitResponseComplete
  ;(window as unknown as Record<string, unknown>).langqueueCancelChain = () => {
    currentChainAborted = true
  }
  ;(window as unknown as Record<string, unknown>).langqueueIsChainRunning = () => isChainRunning
  ;(window as unknown as Record<string, unknown>).langqueueExecuteChain = (steps: ChainStep[], insertionModeOverride?: 'overwrite' | 'append') => {
    if (isChainRunning) return Promise.resolve(false)
    isChainRunning = true
    currentChainAborted = false
    return executeChain(steps, insertionModeOverride).finally(() => {
      isChainRunning = false
    })
  }
})()
 



