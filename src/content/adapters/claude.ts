import { Adapter } from './adapter'
import {
  findVisibleFileInput,
  isButtonEnabledAndVisible,
  isVisible,
  setFilesOnInput,
  waitForSelectorsToDisappear,
} from './utils'

class ClaudeAdapter extends Adapter {
  id = 'claude'

  matchesAdapterDomain(): boolean {
    return /claude\.ai/.test(window.location.hostname)
  }

  getInputElement(): HTMLTextAreaElement | null {
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

  clickSend(input?: HTMLTextAreaElement | null): boolean {
    const target = input || this.getInputElement()
    if (!target) return false

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
      '[class*="upload" i][class*="progress" i]',
      '[aria-busy="true"][data-testid*="upload" i]',
    ], options)
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
