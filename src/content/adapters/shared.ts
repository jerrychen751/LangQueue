export function isVisible(el: Element): boolean {
  const htmlEl = el as HTMLElement
  if (!htmlEl) return false
  if (htmlEl.offsetParent !== null) return true
  return htmlEl.getClientRects().length > 0
}

export function isButtonEnabledAndVisible(btn: Element | null): btn is HTMLButtonElement {
  if (!btn) return false
  if (!(btn instanceof HTMLButtonElement)) return false
  if (btn.disabled) return false
  const ariaDisabled = btn.getAttribute('aria-disabled')
  if (ariaDisabled && ariaDisabled.toLowerCase() === 'true') return false
  return isVisible(btn)
}
