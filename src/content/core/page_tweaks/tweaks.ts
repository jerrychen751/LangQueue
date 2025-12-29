import type { AppSettings } from '../../../types'

const STYLE_ID = 'langqueue-tweaks-style'
const ROOT_CLASS = 'langqueue-no-autoscroll'

const CSS = `
  .${ROOT_CLASS}, .${ROOT_CLASS} * {
    overflow-anchor: none !important;
  }
`

export function applyTweaks(settings: AppSettings) {
  const enable = Boolean(settings.tweaks?.preventAutoScrollOnSubmit)
  document.documentElement.classList.toggle(ROOT_CLASS, enable)
  let style = document.getElementById(STYLE_ID) as HTMLStyleElement | null
  if (enable) {
    if (!style) {
      style = document.createElement('style')
      style.id = STYLE_ID
      style.textContent = CSS
      document.documentElement.appendChild(style)
    }
  } else if (style) {
    style.remove()
  }
}

