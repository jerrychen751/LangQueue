(() => {
  // Import types inline via type-only dynamic to avoid bundler issues
  type KnownMessage =
    | { type: 'INJECT_PROMPT'; payload: { content: string } }
    | { type: 'COMPAT_CHECK' }
    | { type: 'OPEN_POPUP' }
    | { type: 'TEXTAREA_READY' }
    | { type: 'INJECT_PROMPT_RESULT'; payload: { ok: boolean; reason?: string } }
    | { type: 'INJECT_PROMPT_ERROR'; payload: { reason: string } }
    | { type: 'COMPAT_STATUS'; payload: { ready: boolean } }

  const scriptMark = '__langqueue_chatgpt_content__'
  if ((window as unknown as Record<string, unknown>)[scriptMark]) return
  ;(window as unknown as Record<string, unknown>)[scriptMark] = true

  let inputEl: HTMLTextAreaElement | HTMLElement | null = null

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
})()


