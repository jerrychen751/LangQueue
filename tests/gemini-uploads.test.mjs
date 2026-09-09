import test from 'node:test'
import assert from 'node:assert/strict'
import { createGeminiAdapter } from '../src/content/adapters/gemini.ts'

function createFixture(context) {
  context.mock.timers.enable({ apis: ['Date', 'setTimeout'] })
  class FileInput {
    type = 'file'
    disabled = false
    files = []
    dispatchEvent() {}
  }
  globalThis.HTMLInputElement = FileInput
  globalThis.DataTransfer = class { files = []; items = { add: file => this.files.push(file) } }
  globalThis.location = { href: 'https://gemini.google.com/app/test' }
  const fixture = { previews: [], busy: [], errors: [], send: {}, descriptions: new Map() }
  const input = new FileInput()
  const scope = { querySelectorAll: () => [input] }
  const area = {
    localName: 'input-area-v2',
    isConnected: true,
    querySelectorAll(selector) {
      if (selector === 'uploader-file-preview') return fixture.previews
      if (selector.startsWith('.gem-attachment-loading-error')) return fixture.errors
      return fixture.busy
    },
  }
  const composer = { isConnected: true, parentElement: scope, closest: selector => selector === 'input-area-v2' ? area : null }
  globalThis.document = { body: {}, documentElement: {}, getElementById: id => fixture.descriptions.get(id) }
  const adapter = createGeminiAdapter()
  adapter.getInputElement = () => composer
  adapter.getSendButton = () => fixture.send
  function addPreview(name, kind = 'document') {
    const id = `file-${fixture.descriptions.size}`
    fixture.descriptions.set(id, { textContent: name })
    const marker = { offsetParent: {} }
    const image = { offsetParent: {}, complete: true, naturalWidth: 64, naturalHeight: 64, src: 'blob:local-preview' }
    const preview = {
      offsetParent: {},
      getClientRects: () => [],
      querySelector: () => ({ getAttribute: () => id }),
      querySelectorAll(selector) {
        if (selector.startsWith('gem-attachment ')) return kind === 'document' ? [marker] : []
        return kind === 'image' ? [image] : []
      },
    }
    fixture.previews.push(preview)
    return { preview, image }
  }
  return Object.assign(fixture, { adapter, input, composer, area, addPreview })
}

for (const kind of ['document', 'image']) {
  test(`Gemini accepts a named ${kind} only after its preview and send are ready`, async context => {
    const fixture = createFixture(context)
    const files = [new File(['test'], kind === 'image' ? 'test.png' : 'test.txt')]
    assert.equal((await fixture.adapter.attachFiles(files)).ok, true)
    const { image } = fixture.addPreview(files[0].name, kind)
    fixture.send = null
    image.complete = false
    const pending = fixture.adapter.waitForUploadsComplete({ files, timeoutMs: 100, pollMs: 5 })
    fixture.send = {}
    image.complete = true
    context.mock.timers.tick(6)
    assert.equal(await pending, true)
    assert.equal(await fixture.adapter.waitForUploadsComplete({ files }), false)
  })
}

for (const scenario of ['no previews', 'partial', 'preexisting', 'duplicate requested', 'hidden', 'unloaded image', 'send disabled', 'busy', 'wrong filename']) {
  test(`Gemini does not complete uploads with ${scenario}`, async context => {
    const fixture = createFixture(context)
    const files = [new File(['test'], 'test.txt')]
    if (scenario === 'partial') files.push(new File(['second'], 'second.txt'))
    if (scenario === 'duplicate requested') files.push(new File(['second'], 'test.txt'))
    if (scenario === 'preexisting') fixture.addPreview('test.txt')
    await fixture.adapter.attachFiles(files)
    if (!['no previews', 'preexisting'].includes(scenario)) {
      const { preview, image } = fixture.addPreview(scenario === 'wrong filename' ? 'another.txt' : 'test.txt', scenario === 'unloaded image' ? 'image' : 'document')
      if (scenario === 'hidden') preview.offsetParent = null
      if (scenario === 'unloaded image') image.complete = false
    }
    if (scenario === 'send disabled') fixture.send = null
    if (scenario === 'busy') fixture.busy = [{ offsetParent: {} }]
    const pending = fixture.adapter.waitForUploadsComplete({ files, timeoutMs: 20, pollMs: 5 })
    context.mock.timers.tick(21)
    assert.equal(await pending, false)
  })
}

test('Gemini counts duplicate new filenames beyond existing previews', async context => {
  const fixture = createFixture(context)
  fixture.addPreview('test.txt')
  const files = [new File(['a'], 'test.txt'), new File(['b'], 'test.txt')]
  await fixture.adapter.attachFiles(files)
  fixture.addPreview('test.txt')
  const pending = fixture.adapter.waitForUploadsComplete({ files, timeoutMs: 50, pollMs: 5 })
  fixture.addPreview('test.txt')
  context.mock.timers.tick(6)
  assert.equal(await pending, true)
})

test('Gemini rejects provider error even with named previews and enabled send', async context => {
  const fixture = createFixture(context)
  const files = [new File(['test'], 'test.txt')]
  await fixture.adapter.attachFiles(files)
  fixture.addPreview('test.txt')
  fixture.errors = [{ offsetParent: {} }]
  assert.equal(await fixture.adapter.waitForUploadsComplete({ files }), false)
})

for (const scenario of ['navigation', 'composer replacement', 'area replacement', 'disconnected', 'superseded']) {
  test(`Gemini stops checking uploads after ${scenario}`, async context => {
    const fixture = createFixture(context)
    const files = [new File(['test'], 'test.txt')]
    await fixture.adapter.attachFiles(files)
    const pending = fixture.adapter.waitForUploadsComplete({ files, timeoutMs: 50, pollMs: 5 })
    if (scenario === 'navigation') globalThis.location.href += '-new'
    if (scenario === 'composer replacement') fixture.adapter.getInputElement = () => ({})
    if (scenario === 'area replacement') fixture.composer.closest = () => ({})
    if (scenario === 'disconnected') fixture.area.isConnected = false
    if (scenario === 'superseded') await fixture.adapter.attachFiles(files)
    fixture.addPreview('test.txt')
    context.mock.timers.tick(6)
    assert.equal(await pending, false)
  })
}

test('Gemini refuses unknown acceptance context before assigning files', async context => {
  const fixture = createFixture(context)
  fixture.composer.closest = () => null
  assert.equal((await fixture.adapter.attachFiles([new File(['test'], 'test.txt')])).ok, false)
  assert.equal(fixture.input.files.length, 0)
})

test('Gemini requires the exact files from the active attempt', async context => {
  const fixture = createFixture(context)
  const files = [new File(['test'], 'test.txt')]
  await fixture.adapter.attachFiles(files)
  fixture.addPreview('test.txt')
  assert.equal(await fixture.adapter.waitForUploadsComplete(), false)
  assert.equal(await fixture.adapter.waitForUploadsComplete({ files: [new File(['test'], 'test.txt')] }), false)
  assert.equal(await fixture.adapter.waitForUploadsComplete({ files }), true)
})

test('Gemini waits for loading to clear and ignores hidden error markers', async context => {
  const fixture = createFixture(context)
  const files = [new File(['test'], 'test.txt')]
  await fixture.adapter.attachFiles(files)
  fixture.addPreview('test.txt')
  fixture.errors = [{ offsetParent: null, getClientRects: () => [] }]
  fixture.busy = [{ offsetParent: {} }]
  const pending = fixture.adapter.waitForUploadsComplete({ files, timeoutMs: 50, pollMs: 5 })
  fixture.busy = []
  context.mock.timers.tick(6)
  assert.equal(await pending, true)
})

test('Gemini waits when the full filename description is unavailable', async context => {
  const fixture = createFixture(context)
  const files = [new File(['test'], 'test.txt')]
  await fixture.adapter.attachFiles(files)
  fixture.addPreview('test.txt')
  fixture.descriptions.clear()
  const pending = fixture.adapter.waitForUploadsComplete({ files, timeoutMs: 20, pollMs: 5 })
  context.mock.timers.tick(21)
  assert.equal(await pending, false)
})

test('Gemini refuses an unidentified existing preview before assigning new files', async context => {
  const fixture = createFixture(context)
  fixture.addPreview('test.txt')
  const description = fixture.descriptions.get('file-0')
  fixture.descriptions.clear()
  const files = [new File(['new'], 'test.txt')]
  const result = await fixture.adapter.attachFiles(files)
  assert.equal(result.ok, false)
  assert.match(result.error, /existing attachment is not ready to identify/)
  assert.equal(fixture.input.files.length, 0)
  fixture.descriptions.set('file-0', description)
  assert.equal(await fixture.adapter.waitForUploadsComplete({ files }), false)
})
