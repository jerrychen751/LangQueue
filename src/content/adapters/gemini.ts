import { Adapter } from './adapter'
import {
  findEnabledFileInput,
  findComposerSendButton,
  isFileInputEnabled,
  isButtonEnabledAndVisible,
  isVisible,
  setFilesOnInput,
} from './page_dom'

class GeminiAdapter extends Adapter {
  id = 'gemini' as const
  private uploadAttempt: { composer: HTMLTextAreaElement; area: Element; href: string; files: File[]; counts: Map<string, number> } | null = null

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
    this.uploadAttempt = null
    const composer = this.getInputElement()
    const input = findEnabledFileInput(composer, [])
    const failure = { ok: false, error: 'A safe chat uploader was not found. Attach the files manually in the chat composer; automatic upload is unavailable.' }
    const area = composer?.closest('input-area-v2')
    if (!composer || area?.localName !== 'input-area-v2') return failure
    if (input) return this.assignUploadFiles(input, files, composer, area)
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
        if (uploaders.length === 1) return isFileInputEnabled(uploaders[0]) ? this.assignUploadFiles(uploaders[0], files, composer, area) : failure
      }
      await new Promise(resolve => setTimeout(resolve, 50))
    }
    return failure
  }

  private assignUploadFiles(input: HTMLInputElement, files: File[], composer: HTMLTextAreaElement, area: Element) {
    if (!composer.isConnected || !area.isConnected || this.getInputElement() !== composer) return { ok: false, error: 'The chat composer changed before attachment upload.' }
    const counts = new Map<string, number>()
    for (const preview of area.querySelectorAll('uploader-file-preview')) {
      const name = this.getUploadFilename(preview)
      if (!name) return { ok: false, error: 'An existing attachment is not ready to identify. Finish or remove it before uploading another prompt.' }
      counts.set(name, (counts.get(name) || 0) + 1)
    }
    this.uploadAttempt = { composer, area, href: location.href, files: [...files], counts }
    const result = setFilesOnInput(input, files)
    if (!result.ok) this.uploadAttempt = null
    return result
  }

  private getUploadFilename(preview: Element): string | null {
    const ids = preview.querySelector('.file-preview-container[aria-describedby]')?.getAttribute('aria-describedby')?.split(/\s+/) || []
    const names = ids.map(id => document.getElementById(id)?.textContent?.trim()).filter((name): name is string => Boolean(name))
    return names.length === 1 ? names[0] : null
  }

  async waitForUploadsComplete(options?: { timeoutMs?: number; pollMs?: number; files?: File[] }): Promise<boolean> {
    const attempt = this.uploadAttempt
    const files = options?.files
    if (!attempt || !files?.length || files.length !== attempt.files.length || files.some((file, index) => file !== attempt.files[index])) return false
    const expected = new Map(attempt.counts)
    for (const file of files) expected.set(file.name, (expected.get(file.name) || 0) + 1)
    const started = Date.now()
    while (Date.now() - started < (options?.timeoutMs ?? 60000)) {
      if (this.uploadAttempt !== attempt || location.href !== attempt.href || !attempt.composer.isConnected || !attempt.area.isConnected || this.getInputElement() !== attempt.composer || attempt.composer.closest('input-area-v2') !== attempt.area) {
        if (this.uploadAttempt === attempt) this.uploadAttempt = null
        return false
      }
      const rejected = Array.from(attempt.area.querySelectorAll('.gem-attachment-loading-error, gem-icon[fonticonname="error"]')).some(isVisible)
      if (rejected) {
        this.uploadAttempt = null
        return false
      }
      const accepted = new Map<string, number>()
      for (const preview of attempt.area.querySelectorAll('uploader-file-preview')) {
        if (!isVisible(preview)) continue
        const name = this.getUploadFilename(preview)
        if (!name) continue
        const hasDocument = Array.from(preview.querySelectorAll('gem-attachment .gem-attachment-text')).some(isVisible) && Array.from(preview.querySelectorAll('gem-attachment .gem-attachment-extension-label')).some(isVisible)
        const hasImage = Array.from(preview.querySelectorAll<HTMLImageElement>('gem-media-attachment img.gem-attachment-style-img[alt="attachment"]')).some(image => isVisible(image) && image.complete && image.naturalWidth > 0 && image.naturalHeight > 0)
        if (hasDocument || hasImage) accepted.set(name, (accepted.get(name) || 0) + 1)
      }
      const busy = Array.from(attempt.area.querySelectorAll('[aria-busy="true"], [aria-label*="Uploading" i], [class*="upload" i][class*="progress" i], [role="progressbar"], .gem-attachment-loading, mat-spinner, mat-progress-spinner')).some(isVisible)
      if (files.every(file => (accepted.get(file.name) || 0) >= expected.get(file.name)!) && !busy && this.getSendButton(attempt.composer)) {
        this.uploadAttempt = null
        return true
      }
      await new Promise(resolve => setTimeout(resolve, options?.pollMs ?? 200))
    }
    if (this.uploadAttempt === attempt) this.uploadAttempt = null
    return false
  }

}

export function createGeminiAdapter(): Adapter {
  return new GeminiAdapter()
}
