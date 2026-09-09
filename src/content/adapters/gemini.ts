import { Adapter } from './adapter'
import {
  findEnabledFileInput,
  findComposerSendButton,
  isVisible,
  setFilesOnInput,
  waitForSelectorsToDisappear,
} from './utils'

class GeminiAdapter extends Adapter {
  id = 'gemini' as const

  matchesAdapterDomain(): boolean {
    return /gemini\.google\.com/.test(window.location.hostname)
  }

  getInputElement(): HTMLTextAreaElement | null {
    // Gemini uses a contenteditable div with aria-label="Enter a prompt for Gemini"
    const contentEditables = Array.from(
      document.querySelectorAll('div[contenteditable="true"]')
    ) as HTMLElement[]
    const visibleCEs = contentEditables.filter((e) => isVisible(e))

    if (visibleCEs.length === 1) {
      return visibleCEs[0] as unknown as HTMLTextAreaElement
    } else if (visibleCEs.length > 1) {
      const keywords = ['gemini', 'prompt', 'message', 'chat']
      const match = visibleCEs.find((e) => {
        const label = (e.getAttribute('aria-label') || '').toLowerCase()
        return keywords.some((kw) => label.includes(kw))
      })
      if (match) return match as unknown as HTMLTextAreaElement
    }

    // Fallback: try textarea
    const textareas = Array.from(document.querySelectorAll('textarea')) as HTMLTextAreaElement[]
    const visibleTA = textareas.find((e) => isVisible(e))
    return visibleTA ?? null
  }

  isGenerating(): boolean {
    // Stop button only exists during generation (send button with .stop class toggled)
    if (document.querySelector('button[aria-label="Stop response"]')) return true
    if (document.querySelector('.send-button.stop')) return true

    // Response footer without .complete means still generating
    if (document.querySelector('.response-footer:not(.complete)')) return true

    // Animated footer on the actively streaming response
    if (document.querySelector('.response-footer.animated')) return true

    return false
  }

  clickSend(input?: HTMLTextAreaElement | null): boolean {
    const target = input || this.getInputElement()
    if (!target) return false

    const candidate = findComposerSendButton(target, [
      'button[aria-label="Send message"]',
      'button.send-button',
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
    const input = findEnabledFileInput([
      'input[type="file"][accept*="image" i]',
      'input[type="file"]',
    ])
    if (!input) return { ok: false, error: 'UPLOAD_INPUT_NOT_FOUND' }
    return setFilesOnInput(input, files)
  }

  async waitForUploadsComplete(options?: { timeoutMs?: number; pollMs?: number }): Promise<boolean> {
    return waitForSelectorsToDisappear([
      '[aria-label*="Uploading" i]',
      '[class*="upload" i][class*="progress" i]',
      '[role="progressbar"]',
    ], options)
  }

}

export function createGeminiAdapter(): Adapter {
  return new GeminiAdapter()
}
