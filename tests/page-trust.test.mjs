import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import test from 'node:test'
import vm from 'node:vm'

const require = createRequire(resolve('package.json'))
const ts = require('typescript')

function createFixture(path, dependencies = {}) {
  const nodes = []
  class Element {
    listeners = new Map()
    children = []
    style = {}
    dataset = {}
    shadowRoot = null
    value = ''
    constructor(tag) { this.tagName = tag; nodes.push(this) }
    setAttribute(name, value) { this[name] = value }
    append(...children) { this.children.push(...children) }
    appendChild(child) { this.append(child) }
    replaceChildren(...children) { this.children = children }
    attachShadow({ mode }) { const root = new Element('shadow'); if (mode === 'open') this.shadowRoot = root; return root }
    addEventListener(type, listener) { const list = this.listeners.get(type) || []; list.push(listener); this.listeners.set(type, list) }
    dispatch(type, values = {}) { for (const listener of this.listeners.get(type) || []) listener({ isTrusted: false, target: this, button: 0, preventDefault() {}, stopPropagation() {}, ...values }) }
    querySelector(selector) { return this.querySelectorAll(selector)[0] || new Element(selector) }
    querySelectorAll(selector) { return this.children.flatMap(child => [child, ...child.querySelectorAll(selector)]).filter(child => selector.startsWith('.') ? child.className?.split(' ').includes(selector.slice(1)) : child.tagName === selector) }
    getBoundingClientRect() { return { height: 50 } }
    scrollIntoView() {}
    focus() {}
    contains(node) { return this === node || this.children.some(child => child.contains(node)) }
  }
  const document = new Element('document')
  document.documentElement = new Element('html')
  document.createElement = tag => new Element(tag)
  const exports = {}
  vm.runInNewContext(ts.transpileModule(readFileSync(resolve(path), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, {
    exports, document, navigator: { userAgent: 'Mac' }, HTMLElement: Element,
    CSSStyleSheet: class { replaceSync() {} }, setTimeout() {},
    window: { addEventListener() {} }, MutationObserver: class { observe() {} },
    chrome: { runtime: { sendMessage: async () => {}, onMessage: { addListener(listener) { document.receive = listener } } }, storage: { onChanged: { addListener() {} } } },
    require(name) { return dependencies[name] || {} },
  })
  return { exports, document, nodes, Element }
}

test('overlay hides its shadow root and ignores synthetic selection and edit actions', () => {
  let selected = 0
  let edited = 0
  let created = 0
  const fixture = createFixture('src/content/core/overlay/overlay.ts')
  const overlay = fixture.exports.createOverlay({ onSelect() { selected++ }, onEdit() { edited++ }, onCreate() { created++ }, onClose() {} })
  overlay.show({ x: 10, top: 100, bottom: 120 }, [{ kind: 'chain', id: 'chain', title: 'Chain', steps: [{ content: 'private' }] }, { kind: 'prompt', id: 'prompt', title: 'Prompt', content: 'private' }], '')
  assert.equal(fixture.document.documentElement.children[0].shadowRoot, null)
  for (const node of fixture.nodes) { node.dispatch('mousedown'); node.dispatch('click') }
  assert.deepEqual([selected, edited, created], [0, 0, 0])
  fixture.nodes.find(node => node.tagName === 'li').dispatch('click', { isTrusted: true })
  assert.equal(selected, 1)
})

test('editor ignores synthetic save, delete, and keyboard shortcuts', async () => {
  let saves = 0
  let deletes = 0
  const fixture = createFixture('src/content/core/editor/editor.ts')
  const editor = fixture.exports.createEditor({ onSave() { saves++; return true }, onDelete() { deletes++; return true } })
  editor.open({ id: 'prompt', title: 'Prompt', content: 'private' })
  assert.equal(fixture.document.documentElement.children[0].shadowRoot, null)
  for (const node of fixture.nodes) node.dispatch('click')
  fixture.document.dispatch('keydown', { key: 'Enter', ctrlKey: true })
  fixture.document.dispatch('keydown', { key: 'Escape' })
  assert.deepEqual([saves, deletes, editor.isOpen()], [0, 0, true])
  fixture.nodes.find(node => node.textContent === 'Save').dispatch('click', { isTrusted: true })
  await Promise.resolve()
  assert.equal(saves, 1)
})

test('queue controls ignore synthetic retry, cancellation, and removal', () => {
  let actions = 0
  const fixture = createFixture('src/content/core/queue/panel.ts')
  fixture.exports.createQueuePanel({
    getSnapshot: () => ({ items: [{ id: 'item', content: 'private' }], status: 'failed', canRetry: true }),
    subscribe(callback) { callback() }, retry() { actions++ }, cancel() { actions++ }, remove() { actions++ }, clearError() { actions++ },
  }, { getSnapshot: () => ({ totalSteps: 0 }), isRunning: () => false, subscribe() {}, cancel() { actions++ } })
  assert.equal(fixture.document.documentElement.children[0].shadowRoot, null)
  for (const node of fixture.nodes) node.dispatch('click')
  assert.equal(actions, 0)
})

test('controller ignores synthetic library input and selection but keeps runtime operations available', async () => {
  let selected = 0
  let searched = 0
  let inserted = 0
  const fixture = createFixture('src/content/core/controller.ts', {
    './editor/editor': { createEditor: () => ({}) },
    './overlay/overlay': { createOverlay: () => ({ isOpen: () => true, selectCurrent() { selected++ } }) },
    './queue/queue': { createQueue: () => ({}) },
    './queue/chain_executor': { createChainExecutor: () => ({}) },
    './queue/panel': { createQueuePanel: () => ({}) },
    './queue/execution': { getConversationHref: () => 'https://chatgpt.com/c/one', createExecutionCoordinator: () => ({}) },
    './messaging': { getSettings: async () => ({}), searchPrompts() { searched++; return [] } },
    './page_tweaks/tweaks': { applyTweaks() {} },
    './insert/composer': { getInputText: element => element.value },
    './insert/manual': { async insertComposerPrompt() { inserted++; return { ok: true } } },
  })
  const input = new fixture.Element('textarea')
  fixture.exports.initController({ getInputElement: () => input, getText: element => element.value })
  fixture.document.dispatch('input', { target: input })
  fixture.document.dispatch('keydown', { key: 'Enter', target: input })
  assert.deepEqual([selected, searched], [0, 0])
  fixture.document.dispatch('keydown', { key: 'Enter', target: input, isTrusted: true })
  assert.equal(selected, 1)
  fixture.document.receive({ type: 'INJECT_PROMPT', payload: { content: 'prompt', expectedHref: 'https://chatgpt.com/c/one' } }, {}, () => {})
  await Promise.resolve()
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(inserted, 1)
})

test('in-page editor allows file-only edits and resets attachment state for new prompts', async () => {
  let saves = 0
  const fixture = createFixture('src/content/core/editor/editor.ts')
  const editor = fixture.exports.createEditor({ onSave() { saves++; return true }, onDelete() { return true } })
  editor.open({ id: 'files', title: 'Files', content: '', attachmentCount: 1 })
  const save = fixture.nodes.find(node => node.textContent === 'Save')
  save.dispatch('click', { isTrusted: true })
  await Promise.resolve()
  assert.equal(saves, 1)
  editor.open({ title: 'Empty', content: '' })
  save.dispatch('click', { isTrusted: true })
  await Promise.resolve()
  assert.equal(saves, 1)
})
