import type { InputElement } from '../types'
import type { SlashContext } from '../detect/slash'

function dispatchFrameworkInput(el: HTMLElement, data: string) {
  try {
    const ie = new InputEvent('input', { bubbles: true, data, inputType: 'insertText' } as InputEventInit)
    el.dispatchEvent(ie)
  } catch {
    el.dispatchEvent(new Event('input', { bubbles: true }))
  }
}

function setTextareaValue(el: HTMLTextAreaElement, value: string) {
  const nativeSetter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
  nativeSetter?.call(el, value)
  el.dispatchEvent(new Event('input', { bubbles: true }))
  el.focus()
}

function setContentEditableValue(el: HTMLElement, value: string) {
  el.focus()
  const selection = window.getSelection()
  const range = document.createRange()
  range.selectNodeContents(el)
  range.deleteContents()
  const textNode = document.createTextNode(value)
  range.insertNode(textNode)
  range.setStartAfter(textNode)
  range.setEndAfter(textNode)
  selection?.removeAllRanges()
  selection?.addRange(range)
  dispatchFrameworkInput(el, value)
}

function appendToContentEditable(el: HTMLElement, value: string) {
  el.focus()
  const selection = window.getSelection()
  const range = document.createRange()
  range.selectNodeContents(el)
  range.collapse(false)
  const needsNewline = (el.textContent || '').length > 0
  const textToInsert = `${needsNewline ? '\n' : ''}${value}`
  const textNode = document.createTextNode(textToInsert)
  range.insertNode(textNode)
  range.setStartAfter(textNode)
  range.setEndAfter(textNode)
  selection?.removeAllRanges()
  selection?.addRange(range)
  dispatchFrameworkInput(el, textToInsert)
}

export function getInputText(el: InputElement | null): string {
  if (!el) return ''
  if (el instanceof HTMLTextAreaElement) return el.value || ''
  return el.textContent || ''
}

export function setInputText(el: InputElement, value: string) {
  if (el instanceof HTMLTextAreaElement) {
    setTextareaValue(el, value)
  } else {
    setContentEditableValue(el, value)
  }
}

export function appendInputText(el: InputElement, value: string) {
  if (el instanceof HTMLTextAreaElement) {
    const existing = el.value || ''
    const next = existing ? `${existing}\n${value}` : value
    setTextareaValue(el, next)
    const len = next.length
    try {
      el.setSelectionRange(len, len)
    } catch {
      void 0
    }
  } else {
    appendToContentEditable(el, value)
  }
}

export function replaceSlashContext(context: SlashContext, replacement: string) {
  if (context.kind === 'textarea') {
    const { input, start, end } = context
    input.setRangeText(replacement, start, end, 'end')
    input.dispatchEvent(new Event('input', { bubbles: true }))
    input.focus()
    return
  }

  const before = context.textBefore.slice(0, context.slashIndex)
  const next = `${before}${replacement}${context.textAfter}`
  setContentEditableValue(context.input, next)
}

