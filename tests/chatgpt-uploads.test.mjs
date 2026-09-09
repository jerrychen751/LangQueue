import test from 'node:test'
import assert from 'node:assert/strict'
import { createChatGPTAdapter } from '../src/content/adapters/chatgpt.ts'

function createFixture(context) {
  context.mock.timers.enable({ apis: ['Date', 'setTimeout'] })
  class FileInput {
    type = 'file'
    disabled = false
    dispatchEvent() {}
  }
  class Button {
    disabled = false
    offsetParent = {}
    attributes = {}
    getAttribute(name) { return this.attributes[name] || null }
  }
  globalThis.HTMLInputElement = FileInput
  globalThis.HTMLButtonElement = Button
  globalThis.DataTransfer = class { files = []; items = { add: file => this.files.push(file) } }
  globalThis.location = { href: 'https://chatgpt.com/c/upload-test' }
  const fileInput = new FileInput()
  const send = new Button()
  const tiles = []
  const indicators = []
  const form = {
    isConnected: true,
    querySelectorAll(selector) {
      if (selector.includes('type="file"')) return [fileInput]
      if (selector.startsWith('button#composer-submit-button')) return [send]
      if (selector.startsWith('[role="group"]')) return tiles
      return indicators
    },
    querySelector() { return send },
  }
  const input = { isConnected: true, closest: () => form }
  globalThis.document = { body: {}, documentElement: {} }
  const adapter = createChatGPTAdapter()
  adapter.getInputElement = () => input
  function addTile(name, accepted = true, visible = true) {
    const tile = {
      getAttribute: () => name,
      getClientRects: () => visible ? [{}] : [],
      querySelectorAll: selector => accepted && selector === '[data-testid="library-file-icon"]' ? [{ getClientRects: () => [{}] }] : [],
    }
    tiles.push(tile)
    return tile
  }
  async function tick(milliseconds) {
    context.mock.timers.tick(milliseconds)
    await Promise.resolve()
    await Promise.resolve()
  }
  return { adapter, form, input, send, indicators, addTile, tick }
}

test('ChatGPT waits for delayed accepted tiles and enabled send, ignoring hidden spinners', async context => {
  const fixture = createFixture(context)
  const files = [{ name: 'notes.txt' }]
  await fixture.adapter.attachFiles(files)
  let completed = false
  const pending = fixture.adapter.waitForUploadsComplete({ files, pollMs: 5, timeoutMs: 50 }).then(result => { completed = true; return result })
  await fixture.tick(5)
  assert.equal(completed, false)
  fixture.addTile('notes.txt')
  fixture.send.disabled = true
  await fixture.tick(5)
  assert.equal(completed, false)
  fixture.send.disabled = false
  let visible = true
  fixture.indicators.push({ getClientRects: () => visible ? [{}] : [] })
  await fixture.tick(5)
  assert.equal(completed, false)
  visible = false
  await fixture.tick(5)
  assert.equal(await pending, true)
})

for (const state of ['missing', 'placeholder', 'hidden', 'wrong-name']) {
  test(`ChatGPT rejects ${state} attachment tiles`, async context => {
    const fixture = createFixture(context)
    const files = [{ name: 'notes.txt' }]
    await fixture.adapter.attachFiles(files)
    if (state !== 'missing') fixture.addTile(state === 'wrong-name' ? 'other.txt' : 'notes.txt', state !== 'placeholder', state !== 'hidden')
    const pending = fixture.adapter.waitForUploadsComplete({ files, pollMs: 5, timeoutMs: 20 })
    await fixture.tick(21)
    assert.equal(await pending, false)
  })
}

test('ChatGPT requires every new file including duplicate names beyond preexisting tiles', async context => {
  const fixture = createFixture(context)
  fixture.addTile('notes.txt')
  const files = [{ name: 'notes.txt' }, { name: 'notes.txt' }, { name: 'other.txt' }]
  await fixture.adapter.attachFiles(files)
  let completed = false
  const pending = fixture.adapter.waitForUploadsComplete({ files, pollMs: 5, timeoutMs: 50 }).then(result => { completed = true; return result })
  fixture.addTile('notes.txt')
  fixture.addTile('other.txt')
  await fixture.tick(5)
  assert.equal(completed, false)
  fixture.addTile('notes.txt')
  await fixture.tick(5)
  assert.equal(await pending, true)
})

for (const change of ['navigation', 'detached-form', 'replaced-input', 'replaced-form', 'superseded-attempt']) {
  test(`ChatGPT stops upload wait after ${change}`, async context => {
    const fixture = createFixture(context)
    const files = [{ name: 'notes.txt' }]
    await fixture.adapter.attachFiles(files)
    const pending = fixture.adapter.waitForUploadsComplete({ files, pollMs: 5, timeoutMs: 50 })
    if (change === 'navigation') location.href = 'https://chatgpt.com/c/other'
    if (change === 'detached-form') fixture.form.isConnected = false
    if (change === 'replaced-input') fixture.adapter.getInputElement = () => ({})
    if (change === 'replaced-form') fixture.input.closest = () => ({})
    if (change === 'superseded-attempt') await fixture.adapter.attachFiles(files)
    fixture.addTile('notes.txt')
    await fixture.tick(5)
    assert.equal(await pending, false)
  })
}

test('ChatGPT requires matching files and consumes successful upload attempts', async context => {
  const fixture = createFixture(context)
  const files = [{ name: 'notes.txt' }]
  await fixture.adapter.attachFiles(files)
  fixture.addTile('notes.txt')
  assert.equal(await fixture.adapter.waitForUploadsComplete(), false)
  assert.equal(await fixture.adapter.waitForUploadsComplete({ files: [{ name: 'notes.txt' }] }), false)
  assert.equal(await fixture.adapter.waitForUploadsComplete({ files }), true)
  assert.equal(await fixture.adapter.waitForUploadsComplete({ files }), false)
})

test('ChatGPT does not accept a stop button as an upload-ready send control', async context => {
  const fixture = createFixture(context)
  const files = [{ name: 'notes.txt' }]
  await fixture.adapter.attachFiles(files)
  fixture.addTile('notes.txt')
  fixture.send.attributes['aria-label'] = 'Stop streaming'
  const pending = fixture.adapter.waitForUploadsComplete({ files, pollMs: 5, timeoutMs: 20 })
  await fixture.tick(21)
  assert.equal(await pending, false)
})

test('ChatGPT waits for loaded server images alongside document attachments', async context => {
  const fixture = createFixture(context)
  const files = [{ name: 'image.png' }, { name: 'notes.txt' }]
  await fixture.adapter.attachFiles(files)
  fixture.addTile('notes.txt')
  const tile = fixture.addTile('image.png', false)
  const image = { src: 'https://chatgpt.com/backend-api/estuary/content', complete: false, naturalWidth: 64, naturalHeight: 64, getClientRects: () => [{}] }
  tile.querySelectorAll = selector => selector === 'button[aria-label="Open image: User uploaded image"] img' ? [image] : []
  let completed = false
  const pending = fixture.adapter.waitForUploadsComplete({ files, pollMs: 5, timeoutMs: 30 }).then(result => { completed = true; return result })
  await fixture.tick(5)
  assert.equal(completed, false)
  image.complete = true
  await fixture.tick(5)
  assert.equal(await pending, true)
})

for (const state of ['broken', 'hidden', 'blob', 'data', 'foreign-origin', 'wrong-path', 'outside-button']) {
  test(`ChatGPT rejects ${state} image previews`, async context => {
    const fixture = createFixture(context)
    const files = [{ name: 'image.png' }]
    await fixture.adapter.attachFiles(files)
    const tile = fixture.addTile('image.png', false)
    const image = { src: 'https://chatgpt.com/backend-api/estuary/content', complete: true, naturalWidth: state === 'broken' ? 0 : 64, naturalHeight: 64, getClientRects: () => state === 'hidden' ? [] : [{}] }
    if (state === 'blob') image.src = 'blob:https://chatgpt.com/local-preview'
    if (state === 'data') image.src = 'data:image/png;base64,fixture'
    if (state === 'foreign-origin') image.src = 'https://example.com/backend-api/estuary/content'
    if (state === 'wrong-path') image.src = 'https://chatgpt.com/local-preview.png'
    tile.querySelectorAll = selector => state !== 'outside-button' && selector === 'button[aria-label="Open image: User uploaded image"] img' ? [image] : []
    const pending = fixture.adapter.waitForUploadsComplete({ files, pollMs: 5, timeoutMs: 20 })
    await fixture.tick(21)
    assert.equal(await pending, false)
  })
}
