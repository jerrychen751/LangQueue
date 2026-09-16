import { Adapter } from './adapter'
import {
  findEnabledFileInput,
  findComposerSendButton,
  isVisible,
  setFilesOnInput,
} from './page_dom'

class ChatGPTAdapter extends Adapter {
  id = 'chatgpt' as const
  private uploadAttempt: { input: HTMLTextAreaElement; form: Element; href: string; files: File[]; counts: Map<string, number> } | null = null

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

  getSendButton(input?: HTMLTextAreaElement | null): HTMLButtonElement | null {
    const target = input || this.getInputElement()
    if (!target) return null

    return findComposerSendButton(target, [
      'button#composer-submit-button',
      'button.composer-submit-btn',
      'button[data-testid="send-button"]',
      'button[aria-label="Send message"]',
    ])
  }

  clickSend(input?: HTMLTextAreaElement | null): boolean {
    const candidate = this.getSendButton(input)
    if (!candidate) return false
    try {
      candidate.click()
      return true
    } catch {
      // Preserve uncertainty after an attempted click
      throw new Error('The send click may have been attempted. Check the conversation before sending again.')
    }
  }

  async attachFiles(files: File[]) {
    this.uploadAttempt = null
    if (!Array.isArray(files) || files.length === 0) return { ok: true }
    const composer = this.getInputElement()
    const input = findEnabledFileInput(composer, ['input#upload-files[type="file"]'])
    if (!input) return { ok: false, error: 'A safe chat uploader was not found. Attach the files manually in the chat composer; automatic upload is unavailable.' }
    const form = composer?.closest('form[data-type="unified-composer"]')
    if (!composer || !form) return { ok: false, error: 'Attachment acceptance cannot be checked in this chat layout. Attach the files manually in the chat composer.' }
    const counts = new Map<string, number>()
    for (const tile of form.querySelectorAll('[role="group"][aria-label]')) {
      const name = tile.getAttribute('aria-label')!
      counts.set(name, (counts.get(name) || 0) + 1)
    }
    this.uploadAttempt = { input: composer, form, href: location.href, files: [...files], counts }
    const result = setFilesOnInput(input, files)
    if (!result.ok) this.uploadAttempt = null
    return result
  }

  async waitForUploadsComplete(options?: { timeoutMs?: number; pollMs?: number; files?: File[] }): Promise<boolean> {
    const attempt = this.uploadAttempt
    const files = options?.files
    if (!attempt || !files?.length || files.length !== attempt.files.length || files.some((file, index) => file !== attempt.files[index])) return false
    const expected = new Map(attempt.counts)
    for (const file of files) expected.set(file.name, (expected.get(file.name) || 0) + 1)
    const started = Date.now()
    while (Date.now() - started < (options?.timeoutMs ?? 60000)) {
      if (this.uploadAttempt !== attempt || location.href !== attempt.href || !attempt.form.isConnected || !attempt.input.isConnected || this.getInputElement() !== attempt.input || attempt.input.closest('form[data-type="unified-composer"]') !== attempt.form) {
        if (this.uploadAttempt === attempt) this.uploadAttempt = null
        return false
      }
      const accepted = new Map<string, number>()
      for (const tile of attempt.form.querySelectorAll('[role="group"][aria-label]')) {
        if (!tile.getClientRects().length) continue
        const hasDocument = Array.from(tile.querySelectorAll('[data-testid="library-file-icon"]')).some(icon => icon.getClientRects().length > 0)
        const hasImage = Array.from(tile.querySelectorAll<HTMLImageElement>('button[aria-label="Open image: User uploaded image"] img')).some(image => {
          if (!image.getClientRects().length || !image.complete || image.naturalWidth <= 0 || image.naturalHeight <= 0) return false
          try {
            const url = new URL(image.currentSrc || image.src, attempt.href)
            return url.origin === new URL(attempt.href).origin && url.pathname === '/backend-api/estuary/content'
          } catch {
            return false
          }
        })
        if (!hasDocument && !hasImage) continue
        const name = tile.getAttribute('aria-label')!
        accepted.set(name, (accepted.get(name) || 0) + 1)
      }
      const busy = Array.from(attempt.form.querySelectorAll('[aria-busy="true"], [aria-label*="Uploading" i], [class*="animate-spin"], [class*="upload" i][class*="progress" i]')).some(node => node.getClientRects().length > 0)
      const send = findComposerSendButton(attempt.input, ['button#composer-submit-button'])
      if (files.every(file => (accepted.get(file.name) || 0) >= expected.get(file.name)!) && !busy && send) {
        this.uploadAttempt = null
        return true
      }
      await new Promise(resolve => setTimeout(resolve, options?.pollMs ?? 200))
    }
    if (this.uploadAttempt === attempt) this.uploadAttempt = null
    return false
  }

}

export function createChatGPTAdapter(): Adapter {
  return new ChatGPTAdapter()
}
