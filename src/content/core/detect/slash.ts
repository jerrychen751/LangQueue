import type { InputElement } from '../types'

export type SlashContext =
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
      slashIndex: number
      textBefore: string
      textAfter: string
      rect: DOMRect
    }

const TRIGGER_RE = /\/\/([^\s]*)$/
const ZERO_WIDTH_RE = /[\u200B-\u200D\u2060\uFEFF]/g
const SPACE_CHARS = new Set([' ', '\u00A0'])

function getSlashMatch(text: string): { query: string; slashIndex: number } | null {
  const match = TRIGGER_RE.exec(text)
  if (!match || typeof match.index !== 'number') return null
  const slashIndex = match.index
  const before = text.slice(0, slashIndex)
  if (before.length === 0) {
    return { query: match[1] ?? '', slashIndex }
  }
  const withoutZeroWidth = before.replace(ZERO_WIDTH_RE, '')
  if (withoutZeroWidth.length === 0) {
    return { query: match[1] ?? '', slashIndex }
  }
  const prevChar = before[before.length - 1]
  if (!SPACE_CHARS.has(prevChar)) return null
  return { query: match[1] ?? '', slashIndex }
}

function isContentEditable(el: HTMLElement): boolean {
  return el.getAttribute('contenteditable') === 'true'
}

export function detectSlashContext(input: InputElement | null): SlashContext | null {
  if (!input) return null

  if (input instanceof HTMLTextAreaElement) {
    const caret = input.selectionStart ?? 0
    const before = (input.value || '').slice(0, caret)
    const match = getSlashMatch(before)
    if (!match) return null
    const rect = input.getBoundingClientRect()
    return {
      kind: 'textarea',
      input,
      query: match.query,
      start: match.slashIndex,
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
    const match = getSlashMatch(textBefore)
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
      slashIndex: match.slashIndex,
      textBefore,
      textAfter,
      rect,
    }
  }

  return null
}
