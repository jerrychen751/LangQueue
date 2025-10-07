(() => {
  // Keep message type local to avoid import issues in content script bundling
  type KnownMessage =
    | { type: 'INJECT_PROMPT'; payload: { content: string } }
    | { type: 'COMPAT_CHECK' }
    | { type: 'OPEN_POPUP' }
    | { type: 'TEXTAREA_READY' }
    | { type: 'INJECT_PROMPT_RESULT'; payload: { ok: boolean; reason?: string } }
    | { type: 'INJECT_PROMPT_ERROR'; payload: { reason: string } }
    | { type: 'COMPAT_STATUS'; payload: { ready: boolean } }

  const scriptMark = '__langqueue_gemini_content__'
  if ((window as unknown as Record<string, unknown>)[scriptMark]) return
  ;(window as unknown as Record<string, unknown>)[scriptMark] = true

  // Gemini uses a contenteditable div as the input in most cases
  const SELECTOR = 'div[contenteditable="true"][role="textbox"], textarea'
  let inputEl: HTMLTextAreaElement | HTMLElement | null = null
  let floatingBtn: HTMLButtonElement | null = null

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

  function ensureFloatingButton() {
    if (!inputEl) return
    if (floatingBtn && floatingBtn.isConnected) return
    floatingBtn = document.createElement('button')
    floatingBtn.setAttribute('type', 'button')
    floatingBtn.title = 'Open LangQueue'
    floatingBtn.style.position = 'absolute'
    floatingBtn.style.right = '10px'
    floatingBtn.style.bottom = '10px'
    floatingBtn.style.zIndex = '2147483647'
    floatingBtn.style.width = '28px'
    floatingBtn.style.height = '28px'
    floatingBtn.style.borderRadius = '9999px'
    floatingBtn.style.border = '1px solid rgba(0,0,0,0.1)'
    floatingBtn.style.background = '#fff'
    floatingBtn.style.boxShadow = '0 1px 2px rgba(0,0,0,0.08)'
    floatingBtn.style.display = 'flex'
    floatingBtn.style.alignItems = 'center'
    floatingBtn.style.justifyContent = 'center'
    floatingBtn.style.cursor = 'pointer'
    floatingBtn.style.transition = 'background 0.15s ease'
    floatingBtn.onmouseenter = () => (floatingBtn!.style.background = '#f5f5f5')
    floatingBtn.onmouseleave = () => (floatingBtn!.style.background = '#fff')
    floatingBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-sparkles"><path d="M12 3v2M5.22 5.22l1.42 1.42M3 12h2m1.78 6.78-1.42 1.42M12 19v2m6.78-1.78-1.42-1.42M19 12h2m-4.22-5.36 1.42-1.42"/><path d="M8 12a4 4 0 1 0 8 0"/></svg>'

    const container = inputEl.closest('div') || inputEl.parentElement || document.body
    if (container && container !== document.body) {
      container.style.position = container.style.position || 'relative'
      container.appendChild(floatingBtn)
    } else {
      document.body.appendChild(floatingBtn)
      floatingBtn.style.position = 'fixed'
    }

    floatingBtn.addEventListener('click', () => {
      chrome.runtime.sendMessage({ type: 'OPEN_POPUP' })
    })
  }

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
      ensureFloatingButton()
    }
  }

  const observer = new MutationObserver(() => scan())
  observer.observe(document.documentElement, { childList: true, subtree: true })
  scan()

  chrome.runtime.onMessage.addListener(handleMessage)
  window.addEventListener('load', scan)
})()



