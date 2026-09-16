type InputElement = HTMLTextAreaElement | HTMLElement

export type ShortcutContext =
  | {
      kind: 'textarea'
      input: HTMLTextAreaElement
      query: string
      start: number
      end: number
      rect: DOMRect
    }
  | {
      kind: 'contenteditable'
      input: HTMLElement
      query: string
      shortcutIndex: number
      textBefore: string
      textAfter: string
      rect: DOMRect
    }

const TRIGGER_RE = /\$([^\s]*)$/
const ZERO_WIDTH_RE = /[\u200B-\u200D\u2060\uFEFF]/g
const SPACE_CHARS = new Set([' ', '\u00A0'])

function getShortcutMatch(text: string): { query: string; shortcutIndex: number } | null {
  const match = TRIGGER_RE.exec(text)
  if (!match || typeof match.index !== 'number') return null
  const shortcutIndex = match.index
  const before = text.slice(0, shortcutIndex)
  if (before.length === 0) {
    return { query: match[1] ?? '', shortcutIndex }
  }
  const withoutZeroWidth = before.replace(ZERO_WIDTH_RE, '')
  if (withoutZeroWidth.length === 0) {
    return { query: match[1] ?? '', shortcutIndex }
  }
  const prevChar = before[before.length - 1]
  if (!SPACE_CHARS.has(prevChar)) return null
  return { query: match[1] ?? '', shortcutIndex }
}

function isContentEditable(el: HTMLElement): boolean {
  return el.getAttribute('contenteditable') === 'true'
}

export function detectShortcutContext(input: InputElement | null): ShortcutContext | null {
  if (!input) return null

  if (input instanceof HTMLTextAreaElement) {
    const caret = input.selectionStart ?? 0
    const before = (input.value || '').slice(0, caret)
    const match = getShortcutMatch(before)
    if (!match) return null
    const rect = input.getBoundingClientRect()
    return {
      kind: 'textarea',
      input,
      query: match.query,
      start: match.shortcutIndex,
      end: caret,
      rect,
    }
  }

  if (input instanceof HTMLElement && isContentEditable(input)) {
    const selection = window.getSelection()
    if (!selection || selection.rangeCount === 0) return null
    const range = selection.getRangeAt(0)
    if (!range.collapsed) return null
    if (!input.contains(range.startContainer)) return null

    const beforeRange = range.cloneRange()
    beforeRange.selectNodeContents(input)
    beforeRange.setEnd(range.endContainer, range.endOffset)
    const textBefore = beforeRange.toString()
    const match = getShortcutMatch(textBefore)
    if (!match) return null

    const afterRange = range.cloneRange()
    afterRange.selectNodeContents(input)
    afterRange.setStart(range.endContainer, range.endOffset)
    const textAfter = afterRange.toString()

    const rect = range.getBoundingClientRect().width ? range.getBoundingClientRect() : input.getBoundingClientRect()
    return {
      kind: 'contenteditable',
      input,
      query: match.query,
      shortcutIndex: match.shortcutIndex,
      textBefore,
      textAfter,
      rect,
    }
  }

  return null
}
