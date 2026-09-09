import test from 'node:test'
import assert from 'node:assert/strict'
import { createClaudeAdapter } from '../src/content/adapters/claude.ts'

function createFixture(context) {
  context.mock.timers.enable({ apis: ['Date', 'setTimeout'] })
  class FileInput {
    type = 'file'
    disabled = false
    files = []
    events = 0
    dispatchEvent() { this.events++ }
  }
  globalThis.HTMLInputElement = FileInput
  globalThis.DataTransfer = class { files = []; items = { add: file => this.files.push(file) } }
  globalThis.location = { href: 'https://claude.ai/chat/upload-test' }
  const uploader = new FileInput()
  const tiles = []
  const indicators = []
  const scope = {
    isConnected: true,
    querySelectorAll(selector) {
      if (selector.includes('type="file"')) return []
      if (selector.startsWith('[data-testid="file-thumbnail"]')) return tiles
      return indicators
    },
  }
  const input = { isConnected: true, parentElement: scope, closest: selector => selector === 'form' ? null : scope }
  globalThis.document = { body: {}, documentElement: {}, querySelectorAll: () => [uploader] }
  const adapter = createClaudeAdapter()
  adapter.getInputElement = () => input
  let sendEnabled = true
  adapter.getSendButton = () => sendEnabled ? {} : null
  function addTile(name, kind = 'document', finalized = true) {
    const image = { src: 'blob:https://claude.ai/test-image', complete: true, naturalWidth: 64, naturalHeight: 64, getClientRects: () => [{}] }
    const link = { getClientRects: () => [{}], getAttribute: () => kind === 'document' ? name : null, querySelectorAll: () => [image] }
    const tile = {
      image,
      visible: true,
      finalized,
      hasName: true,
      hasRemove: true,
      getClientRects() { return this.visible ? [{}] : [] },
      getAttribute: () => kind === 'document' ? 'MessageAttachmentsFile' : 'MessageAttachmentsImage',
      querySelector(selector) {
        if (selector === '.sr-only') return this.hasName ? { textContent: name } : null
        return this.finalized ? link : null
      },
      querySelectorAll() { return this.hasRemove ? [{ getAttribute: () => `Remove ${name}` }] : [] },
    }
    tiles.push(tile)
    return tile
  }
  async function tick(milliseconds) {
    context.mock.timers.tick(milliseconds)
    await Promise.resolve()
    await Promise.resolve()
  }
  return { adapter, input, scope, uploader, indicators, addTile, tick, disableSend() { sendEnabled = false }, enableSend() { sendEnabled = true } }
}

test('Claude waits for every finalized document and loaded image, no busy state, and enabled send', async context => {
  const fixture = createFixture(context)
  const files = [{ name: 'notes.txt' }, { name: 'image.png' }]
  await fixture.adapter.attachFiles(files)
  let completed = false
  const pending = fixture.adapter.waitForUploadsComplete({ files, pollMs: 5, timeoutMs: 50 }).then(result => { completed = true; return result })
  await fixture.tick(5)
  assert.equal(completed, false)
  fixture.addTile('notes.txt')
  const tile = fixture.addTile('image.png', 'image')
  tile.image.complete = false
  await fixture.tick(5)
  assert.equal(completed, false)
  tile.image.complete = true
  fixture.disableSend()
  await fixture.tick(5)
  assert.equal(completed, false)
  fixture.enableSend()
  let visible = true
  fixture.indicators.push({ getClientRects: () => visible ? [{}] : [] })
  await fixture.tick(5)
  assert.equal(completed, false)
  visible = false
  await fixture.tick(5)
  assert.equal(await pending, true)
})

for (const state of ['missing', 'partial', 'invalid-placeholder', 'unfinalized-blob', 'data-image', 'broken-image', 'hidden', 'missing-remove', 'wrong-name']) {
  test(`Claude rejects ${state} attachments`, async context => {
    const fixture = createFixture(context)
    const files = [{ name: 'image.png' }]
    if (state === 'partial') files.push({ name: 'notes.txt' })
    await fixture.adapter.attachFiles(files)
    if (state !== 'missing') {
      const tile = fixture.addTile(state === 'wrong-name' ? 'other.png' : 'image.png', 'image', !['invalid-placeholder', 'unfinalized-blob'].includes(state))
      if (state === 'invalid-placeholder' || state === 'data-image') tile.image.src = 'data:image/png;base64,fixture'
      if (state === 'invalid-placeholder') { tile.image.naturalWidth = 1; tile.image.naturalHeight = 1 }
      if (state === 'broken-image') tile.image.naturalWidth = 0
      if (state === 'hidden') tile.visible = false
      if (state === 'missing-remove') tile.hasRemove = false
    }
    const pending = fixture.adapter.waitForUploadsComplete({ files, pollMs: 5, timeoutMs: 20 })
    await fixture.tick(21)
    assert.equal(await pending, false)
  })
}

test('Claude counts duplicate filenames beyond preexisting attachments', async context => {
  const fixture = createFixture(context)
  fixture.addTile('notes.txt')
  const files = [{ name: 'notes.txt' }, { name: 'notes.txt' }]
  await fixture.adapter.attachFiles(files)
  fixture.addTile('notes.txt')
  let completed = false
  const pending = fixture.adapter.waitForUploadsComplete({ files, pollMs: 5, timeoutMs: 30 }).then(result => { completed = true; return result })
  await fixture.tick(5)
  assert.equal(completed, false)
  fixture.addTile('notes.txt')
  await fixture.tick(5)
  assert.equal(await pending, true)
})

for (const change of ['navigation', 'detached', 'replaced-input', 'replaced-scope', 'superseded']) {
  test(`Claude stops upload readiness after ${change}`, async context => {
    const fixture = createFixture(context)
    const files = [{ name: 'notes.txt' }]
    await fixture.adapter.attachFiles(files)
    const pending = fixture.adapter.waitForUploadsComplete({ files, pollMs: 5, timeoutMs: 30 })
    if (change === 'navigation') location.href = 'https://claude.ai/chat/other'
    if (change === 'detached') fixture.scope.isConnected = false
    if (change === 'replaced-input') fixture.adapter.getInputElement = () => ({})
    if (change === 'replaced-scope') fixture.input.closest = () => ({})
    if (change === 'superseded') await fixture.adapter.attachFiles(files)
    fixture.addTile('notes.txt')
    await fixture.tick(5)
    assert.equal(await pending, false)
  })
}

test('Claude rejects unknown acceptance context before assigning files', async context => {
  const fixture = createFixture(context)
  fixture.input.closest = () => null
  const result = await fixture.adapter.attachFiles([{ name: 'notes.txt' }])
  assert.equal(result.ok, false)
  assert.match(result.error, /acceptance cannot be checked/)
  assert.equal(fixture.uploader.events, 0)
  assert.equal(fixture.uploader.files.length, 0)
})

test('Claude requires expected file identities and consumes successful attempts', async context => {
  const fixture = createFixture(context)
  const files = [{ name: 'notes.txt' }]
  await fixture.adapter.attachFiles(files)
  fixture.addTile('notes.txt')
  assert.equal(await fixture.adapter.waitForUploadsComplete(), false)
  assert.equal(await fixture.adapter.waitForUploadsComplete({ files: [{ name: 'notes.txt' }] }), false)
  assert.equal(await fixture.adapter.waitForUploadsComplete({ files }), true)
  assert.equal(await fixture.adapter.waitForUploadsComplete({ files }), false)
})

test('Claude rejects detached acceptance context before assigning files', async context => {
  const fixture = createFixture(context)
  fixture.scope.isConnected = false
  assert.equal((await fixture.adapter.attachFiles([{ name: 'notes.txt' }])).ok, false)
  assert.equal(fixture.uploader.events, 0)
})

test('Claude accepts finalized loaded one-pixel blob images', async context => {
  const fixture = createFixture(context)
  const files = [{ name: 'pixel.png' }]
  await fixture.adapter.attachFiles(files)
  const tile = fixture.addTile('pixel.png', 'image')
  tile.image.naturalWidth = 1
  tile.image.naturalHeight = 1
  assert.equal(await fixture.adapter.waitForUploadsComplete({ files }), true)
})

test('Claude does not count an existing unfinished same-name tile as a newly accepted file', async context => {
  const fixture = createFixture(context)
  const tile = fixture.addTile('image.png', 'image', false)
  tile.hasName = false
  const files = [{ name: 'image.png' }]
  await fixture.adapter.attachFiles(files)
  tile.finalized = true
  tile.hasName = true
  const pending = fixture.adapter.waitForUploadsComplete({ files, pollMs: 5, timeoutMs: 20 })
  await fixture.tick(21)
  assert.equal(await pending, false)
})

test('Claude accepts finalized attachments in a fresh-chat composer without data-form', async context => {
  const fixture = createFixture(context)
  location.href = 'https://claude.ai/new'
  fixture.scope.getAttribute = name => name === 'data-cds' ? 'ChatComposer' : null
  fixture.input.closest = selector => selector === '[data-cds="ChatComposer"]' ? fixture.scope : null
  const files = [{ name: 'notes.txt' }]
  assert.equal(fixture.scope.getAttribute('data-form'), null)
  assert.equal((await fixture.adapter.attachFiles(files)).ok, true)
  fixture.addTile('notes.txt')
  assert.equal(await fixture.adapter.waitForUploadsComplete({ files }), true)
})

test('Claude rejects unidentified existing attachment tiles before assigning more files', async context => {
  const fixture = createFixture(context)
  const tile = fixture.addTile('notes.txt', 'document', false)
  tile.hasName = false
  tile.hasRemove = false
  const result = await fixture.adapter.attachFiles([{ name: 'notes.txt' }])
  assert.equal(result.ok, false)
  assert.match(result.error, /still being identified/)
  assert.equal(fixture.uploader.events, 0)
  assert.equal(fixture.uploader.files.length, 0)
})
