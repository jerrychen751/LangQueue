export function isVisible(el: Element): boolean {
  const htmlEl = el as HTMLElement
  if (!htmlEl) return false
  if (htmlEl.offsetParent !== null) return true
  return htmlEl.getClientRects().length > 0
}

export function isInputReady(input: HTMLTextAreaElement | null): boolean {
  if (!input) return false
  return isVisible(input) && !input.disabled
}

export function isButtonEnabledAndVisible(btn: Element | null): btn is HTMLButtonElement {
  if (!btn) return false
  if (!(btn instanceof HTMLButtonElement)) return false
  if (btn.disabled) return false
  const ariaDisabled = btn.getAttribute('aria-disabled')
  if (ariaDisabled && ariaDisabled.toLowerCase() === 'true') return false
  return isVisible(btn)
}

export function isFileInputEnabled(input: Element | null): input is HTMLInputElement {
  if (!input) return false
  if (!(input instanceof HTMLInputElement)) return false
  if (input.type !== 'file') return false
  if (input.disabled) return false
  return true
}

export function findEnabledFileInput(target: HTMLElement | null, recognizedSelectors: string[]): HTMLInputElement | null {
  if (!target) return null
  const scope = target.closest('form') || target.parentElement
  if (scope && scope !== document.body && scope !== document.documentElement) {
    const recognized = recognizedSelectors.length ? Array.from(scope.querySelectorAll(recognizedSelectors.join(', '))) : []
    if (recognized.length) return recognized.length === 1 && isFileInputEnabled(recognized[0]) ? recognized[0] : null
    const local = Array.from(scope.querySelectorAll('input[type="file"]'))
    if (local.length) return local.length === 1 && isFileInputEnabled(local[0]) ? local[0] : null
  }
  const recognized = recognizedSelectors.length ? Array.from(document.querySelectorAll(recognizedSelectors.join(', '))) : []
  return recognized.length === 1 && isFileInputEnabled(recognized[0]) ? recognized[0] : null
}

export function setFilesOnInput(input: HTMLInputElement, files: File[]): { ok: boolean; error?: string } {
  try {
    const dt = new DataTransfer()
    files.forEach((file) => dt.items.add(file))
    input.files = dt.files
    input.dispatchEvent(new Event('input', { bubbles: true }))
    input.dispatchEvent(new Event('change', { bubbles: true }))
    return { ok: true }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to set files on upload input.'
    return { ok: false, error: message }
  }
}

export async function waitForSelectorsToDisappear(
  selectors: string[],
  options?: { timeoutMs?: number; pollMs?: number }
): Promise<boolean> {
  const timeoutMs = options?.timeoutMs ?? 60000
  const pollMs = options?.pollMs ?? 200
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    const hasBusy = selectors.some((selector) => {
      return Array.from(document.querySelectorAll(selector)).some(isVisible)
    })
    if (!hasBusy) return true
    await new Promise((resolve) => setTimeout(resolve, pollMs))
  }
  return false
}

export function findComposerSendButton(target: HTMLElement, selectors: string[]): HTMLButtonElement | null {
  const form = target.closest('form')
  let scope = form || target.parentElement
  while (scope && scope !== document.body && scope !== document.documentElement) {
    if (!form) {
      const inputs = Array.from(scope.querySelectorAll('textarea, [contenteditable="true"]'))
      if (inputs.some(input => input !== target && !target.contains(input) && isVisible(input))) return null
    }
    const matches = Array.from(scope.querySelectorAll(selectors.join(', ')))
    const candidates = matches.filter(candidate =>
      isButtonEnabledAndVisible(candidate) &&
      !/\bstop\b/i.test(candidate.getAttribute('aria-label') || '') &&
      candidate.getAttribute('data-testid') !== 'stop-button' &&
      !candidate.getAttribute('class')?.split(/\s+/).includes('stop')
    ) as HTMLButtonElement[]
    if (candidates.length > 1) return null
    if (candidates.length === 1) return candidates[0]
    if (form || matches.length) return null
    scope = scope.parentElement
  }
  return null
}
