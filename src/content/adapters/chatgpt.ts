import type { Adapter, InputElement, WaitForIdleOptions } from '../core/types'
import { isButtonEnabledAndVisible, isVisible } from './shared'

function getInputText(el: InputElement | null): string {
  if (!el) return ''
  if (el instanceof HTMLTextAreaElement) return el.value || ''
  return el.textContent || ''
}

function findInput(): InputElement | null {
  const cePrioritySelectors = [
    'div[contenteditable="true"][role="textbox"]',
    'div[contenteditable="true"][data-testid*="prompt" i]',
    'div[contenteditable="true"]',
  ]
  for (const sel of cePrioritySelectors) {
    const el = Array.from(document.querySelectorAll(sel)) as HTMLElement[]
    const found = el.find((n) => isVisible(n))
    if (found) return found
  }

  const byId = document.getElementById('prompt-textarea')
  if (byId && byId.tagName === 'TEXTAREA' && isVisible(byId)) return byId as HTMLTextAreaElement

  const withinForm = Array.from(
    document.querySelectorAll('form textarea:not([readonly]):not([disabled]):not([class*="fallbackTextarea"])')
  ) as HTMLElement[]
  const ta1 = withinForm.find((el) => el.tagName === 'TEXTAREA' && isVisible(el))
  if (ta1) return ta1 as HTMLTextAreaElement

  const anyTextarea = Array.from(document.querySelectorAll('textarea')) as HTMLElement[]
  const ta2 = anyTextarea.find((el) => el.tagName === 'TEXTAREA' && isVisible(el))
  if (ta2) return ta2 as HTMLTextAreaElement

  return null
}

function clickSend(input?: InputElement | null): boolean {
  const target = input || findInput()
  if (!target) return false

  const text = getInputText(target).trim()
  if (!text) return false

  const selectors = [
    '#composer-submit-button',
    'button#composer-submit-button',
    'button.composer-submit-btn',
    'button[data-testid="send-button"]',
    'button[aria-label="Send message"]',
    'button[aria-label*="Send" i]',
    'button[aria-label*="submit" i]',
    'div[role="button"][aria-label*="Send" i]',
    'div[role="button"][data-testid*="send" i]',
    'button[type="submit"]',
    'form button[type="submit"]',
    'form [type="submit"]',
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

  const form = (target as HTMLElement | null)?.closest('form')
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
    try {
      const htmlForm = form as HTMLFormElement
      if (typeof htmlForm.requestSubmit === 'function') {
        htmlForm.requestSubmit()
        return true
      }
    } catch {
      // ignore
    }
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

function isGenerating(): boolean {
  const stopSelectors = [
    'button[aria-label="Stop generating"]',
    'button[aria-label*="Stop" i]',
    'button[data-testid="stop-button"]',
  ]
  const spinnerSelectors = [
    '[class*="spinner" i]',
    '[class*="loading" i]',
    '[class*="generating" i]',
    '[role="progressbar"]',
  ]
  if (anyVisible(stopSelectors)) return true
  if (anyVisible(spinnerSelectors)) return true
  const sendBtn = document.querySelector('button[data-testid="send-button"], button[aria-label*="Send" i]') as HTMLButtonElement | null
  if (sendBtn && isVisible(sendBtn)) {
    const ariaDisabled = sendBtn.getAttribute('aria-disabled')
    const disabledLike = sendBtn.disabled || (ariaDisabled && ariaDisabled.toLowerCase() === 'true')
    if (disabledLike && getInputText(findInput()).trim().length > 0) return true
  }
  return false
}

function isInputReady(input: InputElement | null): boolean {
  if (!input) return false
  if (input instanceof HTMLTextAreaElement) {
    return isVisible(input) && !input.disabled
  }
  const ariaDisabled = input.getAttribute('aria-disabled')
  const ce = input.getAttribute('contenteditable')
  const busy = input.getAttribute('aria-busy')
  return isVisible(input) && (!ariaDisabled || ariaDisabled.toLowerCase() !== 'true') && (ce !== 'false') && (!busy || busy.toLowerCase() !== 'true')
}

async function waitForIdle(options?: WaitForIdleOptions): Promise<boolean> {
  const timeoutMs = options?.timeoutMs ?? 120000
  const pollMs = options?.pollMs ?? 200
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    const input = findInput()
    if (!isGenerating() && isInputReady(input)) return true
    await new Promise((r) => setTimeout(r, pollMs))
  }
  return false
}

export function createChatGPTAdapter(): Adapter {
  return {
    id: 'chatgpt',
    matches: () => /chatgpt\.com|chat\.openai\.com/.test(window.location.hostname),
    findInput,
    isGenerating,
    clickSend,
    waitForIdle,
  }
}
