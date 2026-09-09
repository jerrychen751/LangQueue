import { Adapter } from './adapter'
import {
  findEnabledFileInput,
  findComposerSendButton,
  isFileInputEnabled,
  isButtonEnabledAndVisible,
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

  getSendButton(input?: HTMLTextAreaElement | null): HTMLButtonElement | null {
    const target = input || this.getInputElement()
    if (!target) return null

    return findComposerSendButton(target, [
      'button[aria-label="Send message"]',
      'button.send-button',
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
    if (!Array.isArray(files) || files.length === 0) return { ok: true }
    const composer = this.getInputElement()
    const input = findEnabledFileInput(composer, [])
    if (input) return setFilesOnInput(input, files)
    const failure = { ok: false, error: 'A safe chat uploader was not found. Attach the files manually in the chat composer; automatic upload is unavailable.' }
    const area = composer?.closest('input-area-v2')
    if (!composer || area?.localName !== 'input-area-v2') return failure
    const localScope = composer.closest('form') || composer.parentElement
    if (localScope?.querySelectorAll('input[type="file"]').length) return failure
    const buttons = area.querySelectorAll('button[aria-label="Upload & tools"][aria-haspopup="menu"]')
    if (buttons.length !== 1 || !isButtonEnabledAndVisible(buttons[0])) return failure
    const button = buttons[0]
    const href = location.href
    if (!composer.isConnected || !area.isConnected) return failure
    if (button.getAttribute('aria-expanded') !== 'true') {
      if (Array.from(document.querySelectorAll('[role="menu"]')).some(isVisible)) return failure
      button.click()
    }
    const started = Date.now()
    while (Date.now() - started < 1500) {
      if (location.href !== href || !composer.isConnected || this.getInputElement() !== composer || composer.closest('input-area-v2') !== area || !button.isConnected) return failure
      const menus = Array.from(document.querySelectorAll('[role="menu"]')).filter(isVisible)
      const outer = menus.filter(menu => menu.getAttribute('aria-label') === 'Menu options')
      const nested = menus.filter(menu => menu.getAttribute('aria-label') === 'Upload file options')
      if (menus.some(menu => !outer.includes(menu) && !nested.includes(menu)) || outer.length > 1 || nested.length > 1) return failure
      if (outer.length === 1 && nested.length === 1) {
        if (!outer[0].contains(nested[0]) || button.getAttribute('aria-expanded') !== 'true') return failure
        const uploaders = nested[0].querySelectorAll('images-files-uploader > input.hidden-file-input[type="file"]')
        if (uploaders.length > 1) return failure
        if (uploaders.length === 1) return isFileInputEnabled(uploaders[0]) ? setFilesOnInput(uploaders[0], files) : failure
      }
      await new Promise(resolve => setTimeout(resolve, 50))
    }
    return failure
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
