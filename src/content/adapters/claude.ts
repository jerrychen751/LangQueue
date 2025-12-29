import type { Adapter, InputElement, WaitForIdleOptions } from '../core/types'
import { isButtonEnabledAndVisible, isVisible } from './shared'

function getInputText(el: InputElement | null): string {
  if (!el) return ''
  if (el instanceof HTMLTextAreaElement) return el.value || ''
  return el.textContent || ''
}

function findInput(): InputElement | null {
  const selectors = [
    'div[contenteditable="true"][role="textbox"]',
    'div[aria-label*="Message" i][contenteditable="true"]',
    'div[data-placeholder*="Message" i][contenteditable="true"]',
    'textarea',
  ]
  for (const selector of selectors) {
    const candidate = document.querySelector(selector) as HTMLElement | null
    if (!candidate) continue
    if (candidate.tagName === 'TEXTAREA') return candidate as HTMLTextAreaElement
    if (candidate.getAttribute('contenteditable') === 'true') return candidate
  }
  return null
}

function clickSend(input?: InputElement | null): boolean {
  const target = input || findInput()
  if (!target) return false

  const text = getInputText(target).trim()
  if (!text) return false

  const selectors = [
    'button[aria-label="Send message"]',
    'button[aria-label="Send"]',
    'button[aria-label*="Send" i]',
    'button[data-testid="send-button"]',
    'button[data-testid*="send" i]',
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
    'button[aria-label*="Cancel" i]',
  ]
  const spinnerSelectors = [
    '[class*="spinner" i]',
    '[class*="loading" i]',
    '[class*="generating" i]',
    '[role="progressbar"]',
    '[aria-busy="true"]',
  ]
  if (anyVisible(stopSelectors)) return true
  if (anyVisible(spinnerSelectors)) return true
  const sendBtn = document.querySelector('button[aria-label*="Send" i], button[type="submit"]') as HTMLButtonElement | null
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

export function createClaudeAdapter(): Adapter {
  return {
    id: 'claude',
    matches: () => /claude\.ai/.test(window.location.hostname),
    findInput,
    isGenerating,
    clickSend,
    waitForIdle,
  }
}
