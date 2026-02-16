import { Adapter } from './adapter'
import {
  findVisibleFileInput,
  isButtonEnabledAndVisible,
  isVisible,
  setFilesOnInput,
  waitForSelectorsToDisappear,
} from './utils'

class ChatGPTAdapter extends Adapter {
  id = 'chatgpt' as const

  matchesAdapterDomain(): boolean {
    return /chatgpt\.com|chat\.openai\.com/.test(window.location.hostname)
  }

  getInputElement(): HTMLTextAreaElement | null {
    // ChatGPT uses a contenteditable div as its primary input
    const ceSelectors = [
      'div[contenteditable="true"][role="textbox"]',
      'div[contenteditable="true"][data-testid*="prompt" i]',
      'div[contenteditable="true"]',
    ]
    for (const sel of ceSelectors) {
      const els = Array.from(document.querySelectorAll(sel)) as HTMLElement[]
      const found = els.find((n) => isVisible(n))
      if (found) return found as unknown as HTMLTextAreaElement
    }

    // Fallback: known textarea by id
    const byId = document.getElementById('prompt-textarea')
    if (byId && byId.tagName === 'TEXTAREA' && isVisible(byId)) return byId as HTMLTextAreaElement

    // Fallback: visible textarea within a form
    const withinForm = Array.from(
      document.querySelectorAll('form textarea:not([readonly]):not([disabled]):not([class*="fallbackTextarea"])')
    ) as HTMLElement[]
    const ta1 = withinForm.find((el) => el.tagName === 'TEXTAREA' && isVisible(el))
    if (ta1) return ta1 as HTMLTextAreaElement

    // Last resort: any visible textarea
    const anyTextarea = Array.from(document.querySelectorAll('textarea')) as HTMLElement[]
    const ta2 = anyTextarea.find((el) => el.tagName === 'TEXTAREA' && isVisible(el))
    if (ta2) return ta2 as HTMLTextAreaElement

    return null
  }

  isGenerating(): boolean {
    // Stop button replaces send button during streaming — only exists in the DOM while generating
    if (document.querySelector('button[data-testid="stop-button"]')) return true
    if (document.querySelector('button[aria-label="Stop streaming"]')) return true

    // Active response's markdown container gets this class while streaming
    if (document.querySelector('.streaming-animation')) return true

    return false
  }

  clickSend(input?: HTMLTextAreaElement | null): boolean {
    const target = input || this.getInputElement()
    if (!target) return false

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

  async attachFiles(files: File[]) {
    if (!Array.isArray(files) || files.length === 0) return { ok: true }
    const input = findVisibleFileInput([
      'input[type="file"][accept*="image" i]',
      'input[type="file"]',
    ])
    if (!input) return { ok: false, error: 'UPLOAD_INPUT_NOT_FOUND' }
    return setFilesOnInput(input, files)
  }

  async waitForUploadsComplete(options?: { timeoutMs?: number; pollMs?: number }): Promise<boolean> {
    return waitForSelectorsToDisappear([
      '[aria-label*="Uploading" i]',
      '[data-testid*="upload" i][aria-busy="true"]',
      '[class*="upload" i][class*="progress" i]',
    ], options)
  }

}

export function createChatGPTAdapter(): Adapter {
  return new ChatGPTAdapter()
}
