(() => {
  // Import types inline via type-only dynamic to avoid bundler issues
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

  const scriptMark = '__langqueue_chatgpt_content__'
  if ((window as unknown as Record<string, unknown>)[scriptMark]) return
  ;(window as unknown as Record<string, unknown>)[scriptMark] = true

  let inputEl: HTMLTextAreaElement | HTMLElement | null = null
  let isChainRunning = false
  let currentChainAborted = false

  function isVisible(el: Element): boolean {
    const htmlEl = el as HTMLElement
    if (!htmlEl) return false
    if (htmlEl.offsetParent !== null) return true
    // handle position: fixed/absolute elements
    return htmlEl.getClientRects().length > 0
  }

  function findInput(): HTMLTextAreaElement | HTMLElement | null {
    // 1) Visible contenteditable (preferred on ChatGPT UI)
    const ceCandidates = Array.from(document.querySelectorAll('div[contenteditable="true"][role="textbox"]')) as HTMLElement[]
    const ce = ceCandidates.find((el) => isVisible(el))
    if (ce) return ce

    // 2) Primary textarea by id
    const byId = document.getElementById('prompt-textarea')
    if (byId && byId.tagName === 'TEXTAREA' && isVisible(byId)) {
      return byId as HTMLTextAreaElement
    }

    // 3) Any other visible, enabled textarea that is not the fallback one
    const candidates = Array.from(document.querySelectorAll('form textarea:not([readonly]):not([disabled]):not([class*="fallbackTextarea"])')) as HTMLElement[]
    const ta = candidates.find((el) => el.tagName === 'TEXTAREA' && isVisible(el))
    if (ta) return ta as HTMLTextAreaElement
    return null
  }

  function dispatchReady() {
    if (inputEl) {
      chrome.runtime.sendMessage({ type: 'TEXTAREA_READY' })
    }
  }  

  function setTextareaValue(el: HTMLTextAreaElement, value: string) {
    const nativeSetter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
    nativeSetter?.call(el, value)
    const ev = new Event('input', { bubbles: true })
    el.dispatchEvent(ev)
    el.focus()
  }

  function dispatchFrameworkInput(el: HTMLElement, data: string) {
    try {
      // Use modern InputEvent when available so frameworks receive rich context
      const ie = new InputEvent('input', { bubbles: true, data, inputType: 'insertText' } as unknown as InputEventInit)
      el.dispatchEvent(ie)
    } catch {
      el.dispatchEvent(new Event('input', { bubbles: true }))
    }
  }

  function setContentEditableValue(el: HTMLElement, value: string) {
    el.focus()
    const selection = window.getSelection()
    const range = document.createRange()
    range.selectNodeContents(el)
    range.deleteContents()
    const textNode = document.createTextNode(value)
    range.insertNode(textNode)
    // place caret after inserted text
    range.setStartAfter(textNode)
    range.setEndAfter(textNode)
    selection?.removeAllRanges()
    selection?.addRange(range)
    dispatchFrameworkInput(el, value)
  }

  function appendToContentEditable(el: HTMLElement, value: string) {
    el.focus()
    const selection = window.getSelection()
    const range = document.createRange()
    range.selectNodeContents(el)
    range.collapse(false) // move caret to end
    const needsNewline = (el.textContent || '').length > 0
    const textToInsert = `${needsNewline ? '\n' : ''}${value}`
    const textNode = document.createTextNode(textToInsert)
    range.insertNode(textNode)
    // move caret after inserted text
    range.setStartAfter(textNode)
    range.setEndAfter(textNode)
    selection?.removeAllRanges()
    selection?.addRange(range)
    dispatchFrameworkInput(el, textToInsert)
  }

  async function injectPrompt(content: string) {
    if (!inputEl || !(inputEl as HTMLElement).isConnected || (inputEl as HTMLElement).tagName !== 'TEXTAREA' || !isVisible(inputEl as HTMLElement)) {
      inputEl = findInput()
    }
    if (!inputEl) {
      chrome.runtime.sendMessage({ type: 'INJECT_PROMPT_ERROR', payload: { reason: 'TEXTAREA_NOT_FOUND' } })
      return { ok: false as const, reason: 'TEXTAREA_NOT_FOUND' as const }
    }
    try {
      // Respect insertion mode setting (overwrite | append) from chrome.storage
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
      return { ok: true as const }
    } catch {
      return { ok: false as const, reason: 'UNKNOWN' as const }
    }
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
    // Keep input reference fresh for visibility and empty checks
    if (!inputEl || !(inputEl as HTMLElement).isConnected || !isVisible(inputEl as HTMLElement)) {
      inputEl = findInput()
    }

    const text = getInputText(inputEl).trim()
    if (!text) {
      // Button is generally disabled when input is empty
      return false
    }

    const selectors = [
      'button[data-testid="send-button"]',
      'button[aria-label="Send message"]',
      'button[aria-label*="Send" i]',
      'button[aria-label*="submit" i]',
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

    // Try buttons associated with the input's nearest form
    const form = (inputEl as HTMLElement | null)?.closest('form')
    if (form) {
      const withinForm = Array.from(form.querySelectorAll('button, [type="submit"]')) as HTMLElement[]
      const btn = withinForm.find((el) => el.tagName === 'BUTTON' && isButtonEnabledAndVisible(el)) as HTMLButtonElement | undefined
      if (btn) {
        try {
          btn.click()
          return true
        } catch {
          void 0
        }
      }
    }

    // Fallback: dispatch Enter key on the input element
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
      'button[aria-label="Stop generating"]',
      'button[aria-label*="Stop" i]',
      'button[data-testid="stop-button"]'
    ]
    const spinnerSelectors = [
      '[class*="spinner" i]',
      '[class*="loading" i]',
      '[class*="generating" i]',
      '[role="progressbar"]'
    ]
    if (anyVisible(stopSelectors)) return true
    if (anyVisible(spinnerSelectors)) return true
    // Heuristic: send button disabled while text present can indicate generating
    const sendBtn = document.querySelector('button[data-testid="send-button"], button[aria-label*="Send" i]') as HTMLButtonElement | null
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

      if (!inputEl || !(inputEl as HTMLElement).isConnected || !isVisible(inputEl as HTMLElement)) {
        inputEl = findInput()
      }
      const targetInput = inputEl
      if (!targetInput) {
        chrome.runtime.sendMessage({ type: 'CHAIN_PROGRESS', payload: { stepIndex: i, totalSteps, status: 'error', error: 'TEXTAREA_NOT_FOUND' } })
        return false
      }

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

  // Expose send helper for future flows (e.g., chaining)
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


