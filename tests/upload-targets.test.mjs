import test from 'node:test'
import assert from 'node:assert/strict'
import { createChatGPTAdapter } from '../src/content/adapters/chatgpt.ts'
import { createClaudeAdapter } from '../src/content/adapters/claude.ts'
import { createGeminiAdapter } from '../src/content/adapters/gemini.ts'
import { waitForSelectorsToDisappear } from '../src/content/adapters/utils.ts'

class FakeFileInput {
  type = 'file'
  disabled = false
  files = []
  events = 0
  constructor(attributes = {}) { this.attributes = attributes }
  dispatchEvent() { this.events++ }
}
globalThis.HTMLInputElement = FakeFileInput
globalThis.DataTransfer = class {
  files = []
  items = { add: file => this.files.push(file) }
}

function createScope(inputs) {
  return {
    querySelectorAll(selector) {
      if (selector.includes('#upload-files')) return inputs.filter(input => input.attributes.id === 'upload-files')
      if (selector.includes('data-testid="file-upload"')) return inputs.filter(input => input.attributes['data-testid'] === 'file-upload')
      if (selector.includes('type="file"')) return inputs
      return []
    },
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null },
  }
}

function createFixture(createAdapter, local, outside = [], hasForm = true) {
  const scope = createScope(local)
  const documentScope = createScope([...outside, ...local])
  globalThis.document = { ...documentScope, body: {}, documentElement: {} }
  const composer = { closest: () => hasForm ? scope : null, parentElement: scope }
  const adapter = createAdapter()
  adapter.getInputElement = () => composer
  return adapter
}

for (const [name, createAdapter, recognized] of [
  ['ChatGPT', createChatGPTAdapter, { id: 'upload-files' }],
  ['Claude', createClaudeAdapter, { 'data-testid': 'file-upload' }],
  ['Gemini', createGeminiAdapter, null],
]) {
  test(`${name}: uploader stays inside the composer instead of the profile form`, async () => {
    const profile = new FakeFileInput({ accept: 'image/*' })
    const local = new FakeFileInput()
    const adapter = createFixture(createAdapter, [local], [profile])
    assert.equal((await adapter.attachFiles([new File(['text'], 'sample.txt')])).ok, true)
    assert.equal(local.files.length, 1)
    assert.equal(profile.files.length, 0)
  })
  test(`${name}: missing composer uploader never falls back to avatar upload`, async () => {
    const profile = new FakeFileInput({ accept: 'image/*' })
    const adapter = createFixture(createAdapter, [], [profile])
    const result = await adapter.attachFiles([new File(['text'], 'sample.txt')])
    assert.equal(result.ok, false)
    assert.match(result.error, /Attach the files manually/)
    assert.equal(profile.files.length, 0)
  })
  test(`${name}: multiple generic local uploaders are rejected`, async () => {
    const first = new FakeFileInput()
    const second = new FakeFileInput()
    const adapter = createFixture(createAdapter, [first, second])
    assert.equal((await adapter.attachFiles([new File(['text'], 'sample.txt')])).ok, false)
    assert.equal(first.events + second.events, 0)
  })
  test(`${name}: immediate parent uploader works without a form`, async () => {
    const local = new FakeFileInput()
    const adapter = createFixture(createAdapter, [local], [], false)
    assert.equal((await adapter.attachFiles([new File(['text'], 'sample.txt')])).ok, true)
    assert.equal(local.files.length, 1)
  })
  if (recognized) {
    test(`${name}: one explicitly recognized external uploader is allowed`, async () => {
      const external = new FakeFileInput(recognized)
      const profile = new FakeFileInput()
      const adapter = createFixture(createAdapter, [], [profile, external])
      assert.equal((await adapter.attachFiles([new File(['text'], 'sample.txt')])).ok, true)
      assert.equal(external.files.length, 1)
      assert.equal(profile.files.length, 0)
    })
    test(`${name}: ambiguous recognized external uploaders are rejected`, async () => {
      const first = new FakeFileInput(recognized)
      const second = new FakeFileInput(recognized)
      const adapter = createFixture(createAdapter, [], [first, second])
      assert.equal((await adapter.attachFiles([new File(['text'], 'sample.txt')])).ok, false)
      assert.equal(first.events + second.events, 0)
    })
    test(`${name}: disabled local uploader does not redirect to an external input`, async () => {
      const local = new FakeFileInput()
      local.disabled = true
      const external = new FakeFileInput(recognized)
      const adapter = createFixture(createAdapter, [local], [external])
      assert.equal((await adapter.attachFiles([new File(['text'], 'sample.txt')])).ok, false)
      assert.equal(external.files.length, 0)
    })
  }
}

test('hidden first progress indicator cannot mask a later visible indicator', async context => {
  context.mock.timers.enable({ apis: ['Date', 'setTimeout'] })
  const hidden = { offsetParent: null, getClientRects: () => [] }
  const visible = { offsetParent: {}, getClientRects: () => [] }
  globalThis.document = { querySelector: () => hidden, querySelectorAll: () => [hidden, visible] }
  const pending = waitForSelectorsToDisappear(['upload-progress'], { timeoutMs: 20, pollMs: 5 })
  context.mock.timers.tick(21)
  assert.equal(await pending, false)
})
