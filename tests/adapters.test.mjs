import test from 'node:test'
import assert from 'node:assert/strict'
import { createChatGPTAdapter } from '../src/content/adapters/chatgpt.ts'
import { createClaudeAdapter } from '../src/content/adapters/claude.ts'
import { createGeminiAdapter } from '../src/content/adapters/gemini.ts'

class FakeElement {
  children = []
  parentElement = null
  disabled = false
  offsetParent = {}
  attributes = {}
  clicks = 0
  submissions = 0
  constructor(tagName, attributes = {}) { this.tagName = tagName.toUpperCase(); this.attributes = attributes }
  getAttribute(name) { return this.attributes[name] ?? null }
  getClientRects() { return [] }
  click() { this.clicks++ }
  requestSubmit() { this.submissions++ }
  append(...elements) { for (const element of elements) { element.parentElement = this; this.children.push(element) } }
  contains(element) { return element === this || this.children.some(child => child.contains(element)) }
  closest(selector) { return this.tagName.toLowerCase() === selector ? this : this.parentElement?.closest(selector) ?? null }
  querySelector(selector) { return this.querySelectorAll(selector)[0] ?? null }
  querySelectorAll(selector) {
    const candidates = this.children.flatMap(child => [child, ...child.querySelectorAll('*')])
    return candidates.filter(element => selector.split(',').some(part => {
      part = part.trim()
      if (part === '*') return true
      const tag = part.match(/^[a-z]+/)?.[0]
      if (tag && element.tagName.toLowerCase() !== tag) return false
      const id = part.match(/#([\w-]+)/)?.[1]
      if (id && element.getAttribute('id') !== id) return false
      const className = part.match(/\.([\w-]+)/)?.[1]
      if (className && !element.getAttribute('class')?.split(' ').includes(className)) return false
      for (const match of part.matchAll(/\[([\w-]+)(\*?=)"([^"]+)"(?: i)?\]/g)) {
        const value = element.getAttribute(match[1]) || ''
        if (match[2] === '=' ? value !== match[3] : !value.toLowerCase().includes(match[3].toLowerCase())) return false
      }
      return true
    }))
  }
}
class FakeButton extends FakeElement { constructor(attributes = {}) { super('button', attributes) } }
globalThis.HTMLButtonElement = FakeButton

function createFixture() {
  const html = new FakeElement('html')
  const body = new FakeElement('body')
  const form = new FakeElement('form')
  const input = new FakeElement('textarea')
  html.append(body)
  body.append(form)
  form.append(input)
  globalThis.document = { body, documentElement: html, querySelector: selector => html.querySelector(selector), querySelectorAll: selector => html.querySelectorAll(selector) }
  return { html, body, form, input }
}

for (const [name, createAdapter] of [['ChatGPT', createChatGPTAdapter], ['Claude', createClaudeAdapter], ['Gemini', createGeminiAdapter]]) {
  test(`${name}: absent send button never clicks an unrelated button or submits the form`, () => {
    const { form, input } = createFixture()
    const attachment = new FakeButton({ 'aria-label': 'Attach files' })
    form.append(attachment)
    assert.equal(createAdapter().clickSend(input), false)
    assert.equal(attachment.clicks, 0)
    assert.equal(form.submissions, 0)
  })
  test(`${name}: only sends through the composer form`, () => {
    const { body, form, input } = createFixture()
    const otherForm = new FakeElement('form')
    const otherSend = new FakeButton({ 'aria-label': 'Send message', type: 'submit' })
    otherForm.append(otherSend)
    body.children.unshift(otherForm)
    otherForm.parentElement = body
    const send = new FakeButton({ 'aria-label': 'Send message' })
    form.append(send)
    assert.equal(createAdapter().clickSend(input), true)
    assert.equal(send.clicks, 1)
    assert.equal(otherSend.clicks, 0)
  })
  test(`${name}: disabled or hidden send controls cannot trigger a fallback`, () => {
    const { form, input } = createFixture()
    const disabled = new FakeButton({ 'aria-label': 'Send message' })
    disabled.disabled = true
    const hidden = new FakeButton({ 'aria-label': 'Send message' })
    hidden.offsetParent = null
    const unrelated = new FakeButton({ type: 'submit' })
    form.append(disabled, hidden, unrelated)
    assert.equal(createAdapter().clickSend(input), false)
    assert.equal(disabled.clicks + hidden.clicks + unrelated.clicks + form.submissions, 0)
  })
  test(`${name}: finds an enabled send after a hidden matching control`, () => {
    const { form, input } = createFixture()
    const hidden = new FakeButton({ 'aria-label': 'Send message' })
    hidden.offsetParent = null
    const send = new FakeButton({ 'aria-label': 'Send message' })
    form.append(hidden, send)
    assert.equal(createAdapter().clickSend(input), true)
    assert.equal(hidden.clicks, 0)
    assert.equal(send.clicks, 1)
  })
  test(`${name}: multiple visible send controls fail without a click`, () => {
    const { form, input } = createFixture()
    const first = new FakeButton({ 'aria-label': 'Send message' })
    const second = new FakeButton({ 'aria-label': 'Send message' })
    form.append(first, second)
    assert.equal(createAdapter().clickSend(input), false)
    assert.equal(first.clicks + second.clicks, 0)
  })
  test(`${name}: composer without a form uses its enclosing container`, () => {
    const { body } = createFixture()
    const container = new FakeElement('div')
    const input = new FakeElement('div', { contenteditable: 'true' })
    const send = new FakeButton({ 'aria-label': 'Send message' })
    container.append(input, send)
    body.append(container)
    assert.equal(createAdapter().clickSend(input), true)
    assert.equal(send.clicks, 1)
  })
  test(`${name}: never searches the document for a missing local send`, () => {
    const { body, input } = createFixture()
    const unrelated = new FakeButton({ 'aria-label': 'Send message' })
    body.append(unrelated)
    assert.equal(createAdapter().clickSend(input), false)
    assert.equal(unrelated.clicks, 0)
  })
}

for (const [name, createAdapter, attributes] of [
  ['ChatGPT', createChatGPTAdapter, { id: 'composer-submit-button' }],
  ['Claude', createClaudeAdapter, { 'data-testid': 'send-button' }],
  ['Gemini', createGeminiAdapter, { class: 'send-button stop' }],
]) {
  test(`${name}: a recognized button in stop mode is never clicked`, () => {
    const { form, input } = createFixture()
    const stop = new FakeButton({ ...attributes, 'aria-label': 'Stop response' })
    form.append(stop)
    assert.equal(createAdapter().clickSend(input), false)
    assert.equal(stop.clicks, 0)
  })
  test(`${name}: aria-disabled sends are unavailable`, () => {
    const { form, input } = createFixture()
    const send = new FakeButton({ 'aria-label': 'Send message', 'aria-disabled': 'true' })
    form.append(send)
    assert.equal(createAdapter().clickSend(input), false)
    assert.equal(send.clicks, 0)
  })
  test(`${name}: does not cross another visible editor to find a send button`, () => {
    const { body } = createFixture()
    const container = new FakeElement('div')
    const firstEditor = new FakeElement('div', { contenteditable: 'true' })
    const secondEditor = new FakeElement('div', { contenteditable: 'true' })
    const send = new FakeButton({ 'aria-label': 'Send message' })
    container.append(firstEditor, secondEditor, send)
    body.append(container)
    assert.equal(createAdapter().clickSend(firstEditor), false)
    assert.equal(send.clicks, 0)
  })
}

for (const [name, createAdapter] of [['ChatGPT', createChatGPTAdapter], ['Claude', createClaudeAdapter], ['Gemini', createGeminiAdapter]]) {
  test(`${name}: a disabled local send prevents searching wider ancestors`, () => {
    const { body } = createFixture()
    const outer = new FakeElement('div')
    const composer = new FakeElement('div')
    const input = new FakeElement('div', { contenteditable: 'true' })
    const disabled = new FakeButton({ 'aria-label': 'Send message' })
    disabled.disabled = true
    composer.append(input, disabled)
    const unrelated = new FakeButton({ 'aria-label': 'Send message' })
    outer.append(composer, unrelated)
    body.append(outer)
    assert.equal(createAdapter().clickSend(input), false)
    assert.equal(unrelated.clicks, 0)
  })
}

for (const [name, createAdapter] of [['ChatGPT', createChatGPTAdapter], ['Claude', createClaudeAdapter], ['Gemini', createGeminiAdapter]]) {
  test(`${name}: readiness discovers an enabled button without clicking`, () => {
    const { form, input } = createFixture()
    const send = new FakeButton({ 'aria-label': 'Send message' })
    send.disabled = true
    form.append(send)
    const adapter = createAdapter()
    assert.equal(adapter.getSendButton(input), null)
    send.disabled = false
    assert.equal(adapter.getSendButton(input), send)
    assert.equal(send.clicks, 0)
  })
  test(`${name}: thrown clicks remain uncertain instead of returning false`, () => {
    const { form, input } = createFixture()
    const send = new FakeButton({ 'aria-label': 'Send message' })
    send.click = () => { send.clicks++; throw new Error('SEND_FAILED') }
    form.append(send)
    assert.throws(() => createAdapter().clickSend(input), /may have been attempted/)
    assert.equal(send.clicks, 1)
  })
}

test('Gemini ignores its auxiliary Quill clipboard when locating Send', () => {
  const { form, input } = createFixture()
  form.tagName = 'DIV'
  const clipboard = new FakeElement('div', { contenteditable: 'true', class: 'ql-clipboard', tabindex: '-1' })
  const send = new FakeButton({ 'aria-label': 'Send message' })
  form.append(clipboard, send)
  assert.equal(createGeminiAdapter().getSendButton(input), send)
  clipboard.attributes.class = 'another-editor'
  assert.equal(createGeminiAdapter().getSendButton(input), null)
})
