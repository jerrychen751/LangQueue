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

export function isFileInputEnabledAndVisible(input: Element | null): input is HTMLInputElement {
  if (!input) return false
  if (!(input instanceof HTMLInputElement)) return false
  if (input.type !== 'file') return false
  if (input.disabled) return false
  return isVisible(input)
}

export function findVisibleFileInput(selectors: string[]): HTMLInputElement | null {
  for (const selector of selectors) {
    const input = document.querySelector(selector)
    if (isFileInputEnabledAndVisible(input)) return input
  }
  const any = document.querySelector('input[type="file"]')
  if (isFileInputEnabledAndVisible(any)) return any
  return null
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
      const el = document.querySelector(selector)
      return Boolean(el && isVisible(el))
    })
    if (!hasBusy) return true
    await new Promise((resolve) => setTimeout(resolve, pollMs))
  }
  return false
}
