import type { InputElement } from '../types'
import type { SlashContext } from '../detect/slash'

function inferInputType(data: string): InputEventInit['inputType'] {
  if (/[\r\n\t]/.test(data) || / {2,}/.test(data)) return 'insertFromPaste'
  return 'insertText'
}

function dispatchFrameworkBeforeInput(el: HTMLElement, data: string, inputType: InputEventInit['inputType']) {
  try {
    const evt = new InputEvent('beforeinput', { bubbles: true, cancelable: true, data, inputType } as InputEventInit)
    el.dispatchEvent(evt)
  } catch {
    void 0
  }
}

function dispatchFrameworkInput(el: HTMLElement, data: string, inputType: InputEventInit['inputType']) {
  try {
    const ie = new InputEvent('input', { bubbles: true, data, inputType } as InputEventInit)
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
  const inputType = inferInputType(value)
  dispatchFrameworkBeforeInput(el, value, inputType)
  const selection = window.getSelection()
  const range = document.createRange()
  range.selectNodeContents(el)
  range.deleteContents()
  range.insertNode(buildLineBreakFragment(value))
  const after = document.createRange()
  after.selectNodeContents(el)
  after.collapse(false)
  selection?.removeAllRanges()
  selection?.addRange(after)
  dispatchFrameworkInput(el, value, inputType)
}

function appendToContentEditable(el: HTMLElement, value: string) {
  el.focus()
  const selection = window.getSelection()
  const range = document.createRange()
  range.selectNodeContents(el)
  range.collapse(false)
  const needsNewline = (el.textContent || '').length > 0
  const textToInsert = `${needsNewline ? '\n' : ''}${value}`
  const inputType = inferInputType(textToInsert)
  dispatchFrameworkBeforeInput(el, textToInsert, inputType)
  range.insertNode(buildLineBreakFragment(textToInsert))
  const after = document.createRange()
  after.selectNodeContents(el)
  after.collapse(false)
  selection?.removeAllRanges()
  selection?.addRange(after)
  dispatchFrameworkInput(el, textToInsert, inputType)
}

function buildLineBreakFragment(value: string): DocumentFragment {
  const fragment = document.createDocumentFragment()
  const lines = value.split(/\r\n|\r|\n/)
  lines.forEach((line, index) => {
    if (line) fragment.appendChild(document.createTextNode(line))
    if (index < lines.length - 1) fragment.appendChild(document.createElement('br'))
  })
  return fragment
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
