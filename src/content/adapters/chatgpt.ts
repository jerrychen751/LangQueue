import { Adapter } from './adapter'
import {
  findEnabledFileInput,
  findComposerSendButton,
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

    const candidate = findComposerSendButton(target, [
      'button#composer-submit-button',
      'button.composer-submit-btn',
      'button[data-testid="send-button"]',
      'button[aria-label="Send message"]',
    ])
    if (!candidate) return false
    try {
      candidate.click()
      return true
    } catch {
      // ignore
    }

    return false
  }

  async attachFiles(files: File[]) {
    if (!Array.isArray(files) || files.length === 0) return { ok: true }
    const input = findEnabledFileInput(this.getInputElement(), ['input#upload-files[type="file"]'])
    if (!input) return { ok: false, error: 'A safe chat uploader was not found. Attach the files manually in the chat composer; automatic upload is unavailable.' }
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
