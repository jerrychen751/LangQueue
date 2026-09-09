import test from 'node:test'
import assert from 'node:assert/strict'
import { createGeminiAdapter } from '../src/content/adapters/gemini.ts'

class FileInput {
  type = 'file'
  disabled = false
  files = []
  dispatchEvent() {}
}
class Button {
  disabled = false
  isConnected = true
  offsetParent = {}
  expanded = 'false'
  clicks = 0
  getAttribute(name) { return name === 'aria-expanded' ? this.expanded : null }
  click() { this.clicks++; this.expanded = 'true'; this.onClick() }
}

function createFixture() {
  globalThis.HTMLInputElement = FileInput
  globalThis.HTMLButtonElement = Button
  globalThis.DataTransfer = class {
    files = []
    items = { add: file => this.files.push(file) }
  }
  globalThis.location = { href: 'https://gemini.google.com/app/test' }
  const fixture = { local: [], menus: [], uploaders: [new FileInput()], files: [new File(['hello'], 'test.txt')] }
  const button = new Button()
  const nested = { offsetParent: {}, getAttribute: () => 'Upload file options', querySelectorAll: () => fixture.uploaders }
  const outer = { offsetParent: {}, getAttribute: () => 'Menu options', contains: node => node === nested }
  const area = { localName: 'input-area-v2', isConnected: true, querySelectorAll: selector => selector === 'uploader-file-preview' ? [] : [button] }
  const scope = { querySelectorAll: () => fixture.local }
  const composer = { isConnected: true, parentElement: scope, closest: selector => selector === 'input-area-v2' ? area : null }
  button.onClick = () => { fixture.menus = [outer, nested] }
  globalThis.document = { body: {}, documentElement: {}, querySelectorAll: () => fixture.menus }
  const adapter = createGeminiAdapter()
  adapter.getInputElement = () => composer
  return Object.assign(fixture, { button, nested, outer, area, composer, adapter })
}

test('Gemini opens the composer upload menu and assigns only the nested uploader', async () => {
  const fixture = createFixture()
  const result = await fixture.adapter.attachFiles(fixture.files)
  assert.equal(result.ok, true)
  assert.equal(fixture.button.clicks, 1)
  assert.deepEqual(fixture.uploaders[0].files, fixture.files)
})

test('Gemini preserves an existing local uploader without opening a menu', async () => {
  const fixture = createFixture()
  fixture.local = [new FileInput()]
  assert.equal((await fixture.adapter.attachFiles(fixture.files)).ok, true)
  assert.equal(fixture.button.clicks, 0)
  assert.deepEqual(fixture.local[0].files, fixture.files)
})

for (const scenario of ['unrelated menu', 'duplicate uploader', 'detached menu', 'navigation', 'composer replacement', 'disabled local']) {
  test(`Gemini rejects ${scenario} without assigning files`, async () => {
    const fixture = createFixture()
    const open = fixture.button.onClick
    if (scenario === 'unrelated menu') fixture.menus = [{ offsetParent: {}, getAttribute: () => 'Other menu' }]
    if (scenario === 'duplicate uploader') fixture.uploaders.push(new FileInput())
    if (scenario === 'detached menu') fixture.outer.contains = () => false
    if (scenario === 'navigation') fixture.button.onClick = () => { open(); globalThis.location.href += '-other' }
    if (scenario === 'composer replacement') fixture.button.onClick = () => { open(); fixture.adapter.getInputElement = () => ({}) }
    if (scenario === 'disabled local') { fixture.local = [new FileInput()]; fixture.local[0].disabled = true }
    assert.equal((await fixture.adapter.attachFiles(fixture.files)).ok, false)
    assert.equal(fixture.uploaders.reduce((count, input) => count + input.files.length, 0), 0)
  })
}

test('Gemini times out when the opened menu never creates an uploader', async context => {
  context.mock.timers.enable({ apis: ['Date', 'setTimeout'] })
  const fixture = createFixture()
  fixture.uploaders = []
  const pending = fixture.adapter.attachFiles(fixture.files)
  context.mock.timers.tick(1501)
  assert.equal((await pending).ok, false)
})

test('Gemini rechecks navigation after waiting for uploader initialization', async context => {
  context.mock.timers.enable({ apis: ['Date', 'setTimeout'] })
  const fixture = createFixture()
  const inputs = fixture.uploaders
  fixture.uploaders = []
  const pending = fixture.adapter.attachFiles(fixture.files)
  fixture.uploaders = inputs
  globalThis.location.href += '-other'
  context.mock.timers.tick(51)
  assert.equal((await pending).ok, false)
  assert.equal(inputs[0].files.length, 0)
})

test('Gemini waits for the exact nested uploader and ignores an external generic input', async context => {
  context.mock.timers.enable({ apis: ['Date', 'setTimeout'] })
  const fixture = createFixture()
  const external = new FileInput()
  const inputs = fixture.uploaders
  fixture.uploaders = []
  fixture.nested.querySelectorAll = selector => {
    assert.equal(selector, 'images-files-uploader > input.hidden-file-input[type="file"]')
    return fixture.uploaders
  }
  globalThis.document.querySelectorAll = selector => selector === '[role="menu"]' ? fixture.menus : [external]
  const pending = fixture.adapter.attachFiles(fixture.files)
  fixture.uploaders = inputs
  context.mock.timers.tick(51)
  assert.equal((await pending).ok, true)
  assert.deepEqual(inputs[0].files, fixture.files)
  assert.equal(external.files.length, 0)
})
