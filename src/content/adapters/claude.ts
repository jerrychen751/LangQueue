import { Adapter } from './adapter'
import {
  findEnabledFileInput,
  findComposerSendButton,
  isVisible,
  setFilesOnInput,
} from './utils'

class ClaudeAdapter extends Adapter {
  id = 'claude'
  private uploadAttempt: { input: HTMLTextAreaElement; scope: Element; href: string; files: File[]; counts: Map<string, number> } | null = null

  matchesAdapterDomain(): boolean {
    return /claude\.ai/.test(window.location.hostname)
  }

  getInputElement(): HTMLTextAreaElement | null {
    const contentEditables = Array.from(
      document.querySelectorAll(
        '[data-testid="chat-input"][contenteditable="true"], [contenteditable="true"][role="textbox"]'
      )
    ) as HTMLElement[]
    const visibleContentEditable = contentEditables.find((element) => isVisible(element))
    if (visibleContentEditable) {
      return visibleContentEditable as unknown as HTMLTextAreaElement
    }

    const allTextareas = Array.from(document.querySelectorAll('textarea'))
    const visibleTextareas = allTextareas.filter((e) => isVisible(e))

    if (visibleTextareas.length === 0) {
      return null
    } else if (visibleTextareas.length === 1) {
      return visibleTextareas[0]
    } else {
      const keywords = ['claude', 'message', 'chat', 'prompt']
      const match = visibleTextareas.find((e) => {
        const label = (e.getAttribute('aria-label') || '').toLowerCase()
        return keywords.some((kw) => label.includes(kw))
      })
      return match ?? null
    }
  }

  isGenerating(): boolean {
    // Match any element on the page with this custom attribute
    if (document.querySelector('[data-is-streaming="true"]')) return true

    // Match buttons with a stop label
    if (document.querySelector('button[aria-label="Stop response"]')) return true

    // Generic fallbacks
    const stopSelectors = [
      'button[aria-label*="Stop" i]',
      'button[aria-label*="Cancel" i]',
    ]
    if (this.anyVisible(stopSelectors)) return true

    return false
  }

  getSendButton(input?: HTMLTextAreaElement | null): HTMLButtonElement | null {
    const target = input || this.getInputElement()
    if (!target) return null

    return findComposerSendButton(target, [
      'button[aria-label="Send message"]',
      'button[aria-label="Send"]',
      'button[data-testid="send-button"]',
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
    const input = findEnabledFileInput(composer, ['input[data-testid="file-upload"][type="file"]'])
    if (!input) return { ok: false, error: 'A safe chat uploader was not found. Attach the files manually in the chat composer; automatic upload is unavailable.' }
    const scope = composer?.closest('[data-cds="ChatComposer"]')
    if (!composer || !scope || !composer.isConnected || !scope.isConnected || this.getInputElement() !== composer) return { ok: false, error: 'Attachment acceptance cannot be checked in this chat layout. Attach the files manually in the chat composer.' }
    const counts = new Map<string, number>()
    for (const tile of scope.querySelectorAll('[data-testid="file-thumbnail"][data-cds-attachment]')) {
      const name = this.getAttachmentName(tile)
      if (!name) return { ok: false, error: 'An existing attachment is still being identified. Wait for it to finish or remove it before attaching more files.' }
      counts.set(name, (counts.get(name) || 0) + 1)
    }
    this.uploadAttempt = { input: composer, scope, href: location.href, files: [...files], counts }
    const result = setFilesOnInput(input, files)
    if (!result.ok) this.uploadAttempt = null
    return result
  }

  private getAttachmentName(tile: Element): string {
    const name = tile.querySelector('.sr-only')?.textContent || tile.querySelector('[data-cds="CardLink"][role="button"]')?.getAttribute('title')
    if (name) return name
    const remove = Array.from(tile.querySelectorAll('button[aria-label]')).find(button => button.getAttribute('aria-label')?.startsWith('Remove '))
    return remove?.getAttribute('aria-label')?.slice('Remove '.length) || ''
  }

  async waitForUploadsComplete(options?: { timeoutMs?: number; pollMs?: number; files?: File[] }): Promise<boolean> {
    const attempt = this.uploadAttempt
    const files = options?.files
    if (!attempt || !files?.length || files.length !== attempt.files.length || files.some((file, index) => file !== attempt.files[index])) return false
    const expected = new Map(attempt.counts)
    for (const file of files) expected.set(file.name, (expected.get(file.name) || 0) + 1)
    const started = Date.now()
    while (Date.now() - started < (options?.timeoutMs ?? 60000)) {
      if (this.uploadAttempt !== attempt || location.href !== attempt.href || !attempt.scope.isConnected || !attempt.input.isConnected || this.getInputElement() !== attempt.input || attempt.input.closest('[data-cds="ChatComposer"]') !== attempt.scope) {
        if (this.uploadAttempt === attempt) this.uploadAttempt = null
        return false
      }
      const accepted = new Map<string, number>()
      for (const tile of attempt.scope.querySelectorAll('[data-testid="file-thumbnail"][data-cds-attachment]')) {
        if (!tile.getClientRects().length) continue
        const link = tile.querySelector('[data-cds="CardLink"][role="button"]')
        if (!link?.getClientRects().length) continue
        const name = this.getAttachmentName(tile)
        if (!name) continue
        if (!Array.from(tile.querySelectorAll('button[aria-label]')).some(button => button.getAttribute('aria-label') === `Remove ${name}`)) continue
        const kind = tile.getAttribute('data-cds')
        const hasDocument = kind === 'MessageAttachmentsFile' && link.getAttribute('title') === name
        const hasImage = kind === 'MessageAttachmentsImage' && Array.from(link.querySelectorAll<HTMLImageElement>('img')).some(image => image.getClientRects().length > 0 && image.complete && image.naturalWidth > 0 && image.naturalHeight > 0 && (image.currentSrc || image.src).startsWith('blob:'))
        if (!hasDocument && !hasImage) continue
        accepted.set(name, (accepted.get(name) || 0) + 1)
      }
      const busy = Array.from(attempt.scope.querySelectorAll('[aria-busy="true"], [aria-label*="Uploading" i], [class*="upload" i][class*="progress" i], [role="alert"]')).some(node => node.getClientRects().length > 0)
      if (files.every(file => (accepted.get(file.name) || 0) >= expected.get(file.name)!) && !busy && this.getSendButton(attempt.input)) {
        this.uploadAttempt = null
        return true
      }
      await new Promise(resolve => setTimeout(resolve, options?.pollMs ?? 200))
    }
    if (this.uploadAttempt === attempt) this.uploadAttempt = null
    return false
  }

  private anyVisible(selectors: string[]): boolean {
    for (const selector of selectors) {
      const el = document.querySelector(selector)
      if (el && isVisible(el)) return true
    }
    return false
  }
}

export function createClaudeAdapter(): Adapter {
  return new ClaudeAdapter()
}
