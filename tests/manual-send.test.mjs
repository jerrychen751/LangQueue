import test from 'node:test'
import assert from 'node:assert/strict'
import { insertComposerPrompt } from '../src/content/core/insert/manual.ts'
import { createExecutionCoordinator } from '../src/content/core/queue/execution.ts'
import { insertAndSendPromptToTab, sendPromptToTab } from '../src/utils/messaging.ts'

class FakeTextarea {
  storedValue = ''
  isConnected = true
  listeners = new Set()
  get value() { return this.storedValue }
  set value(value) { this.storedValue = value.replace(/\r\n|\r/g, '\n') }
  focus() {}
  addEventListener(type, listener) { if (type === 'input') this.listeners.add(listener) }
  removeEventListener(type, listener) { if (type === 'input') this.listeners.delete(listener) }
  dispatchEvent() { for (const listener of this.listeners) listener() }
}
globalThis.HTMLTextAreaElement = FakeTextarea
globalThis.location = { href: 'https://chatgpt.com/' }
globalThis.chrome = { runtime: { sendMessage: async () => ({
  type: 'ATTACHMENT_GET_CHUNK_RESULT', payload: { ok: true, chunkBase64: '', nextOffset: 0, totalBytes: 0, done: true },
}) } }

function createFixture() {
  const coordinator = createExecutionCoordinator()
  const adapter = {
    input: new FakeTextarea(), sends: 0, uploads: 0, generating: false,
    getInputElement() { return this.input },
    isGenerating() { return this.generating },
    getSendButton() { return {} },
    clickSend() { this.sends++; return true },
    async attachFiles() { this.uploads++; return { ok: true } },
    async waitForUploadsComplete() { return true },
  }
  return { adapter, coordinator }
}

const attachments = [{ id: 'fixture', name: 'empty.txt', mimeType: 'text/plain' }]

function insert(fixture, files = [], shouldSend = true, mode = 'overwrite') {
  return insertComposerPrompt(fixture.adapter, fixture.coordinator, 'saved prompt', files, mode, shouldSend, globalThis.location.href)
}

test('combined operation sends once on a fresh chat and releases ownership', async () => {
  const fixture = createFixture()
  const result = await insert(fixture)
  assert.deepEqual(result, { ok: true, sendAttempted: true })
  assert.equal(fixture.adapter.input.value, 'saved prompt')
  assert.equal(fixture.adapter.sends, 1)
  assert.equal(fixture.coordinator.getOwner(), null)
})

test('insertion-only append preserves its mode without sending', async () => {
  const fixture = createFixture()
  fixture.adapter.input.value = 'existing draft'
  const result = await insert(fixture, [], false, 'append')
  assert.equal(result.ok, true)
  assert.equal(fixture.adapter.input.value, 'existing draft\nsaved prompt')
  assert.equal(fixture.adapter.sends, 0)
})

test('composer ownership remains held until upload settles', async () => {
  const fixture = createFixture()
  let finishUpload
  let markUploading
  const uploading = new Promise(resolve => { markUploading = resolve })
  fixture.adapter.waitForUploadsComplete = () => { markUploading(); return new Promise(resolve => { finishUpload = resolve }) }
  const pending = insert(fixture, attachments)
  await uploading
  assert.equal(fixture.coordinator.getOwner(), 'manual')
  assert.equal(fixture.coordinator.tryAcquire('chain'), false)
  assert.equal(fixture.coordinator.tryAcquire('queue'), false)
  finishUpload(true)
  assert.equal((await pending).ok, true)
  assert.equal(fixture.adapter.sends, 1)
})

test('an edited draft during upload is preserved even if the user restores its text', async () => {
  const fixture = createFixture()
  fixture.adapter.input.value = 'original draft'
  fixture.adapter.waitForUploadsComplete = async () => {
    fixture.adapter.input.value = 'edited draft'
    fixture.adapter.input.dispatchEvent(new Event('input'))
    fixture.adapter.input.value = 'original draft'
    return true
  }
  const result = await insert(fixture, attachments)
  assert.equal(result.ok, false)
  assert.match(result.reason, /composer changed/)
  assert.equal(fixture.adapter.input.value, 'original draft')
  assert.equal(fixture.adapter.sends, 0)
})

test('composer replacement during upload prevents insertion and send', async () => {
  const fixture = createFixture()
  const original = fixture.adapter.input
  fixture.adapter.waitForUploadsComplete = async () => {
    original.isConnected = false
    fixture.adapter.input = new FakeTextarea()
    fixture.adapter.input.value = 'replacement draft'
    return true
  }
  const result = await insert(fixture, attachments)
  assert.equal(result.ok, false)
  assert.equal(fixture.adapter.input.value, 'replacement draft')
  assert.equal(fixture.adapter.sends, 0)
  assert.equal(original.listeners.size, 0)
})

test('navigation during upload prevents insertion in the destination', async () => {
  const fixture = createFixture()
  const originalHref = globalThis.location.href
  fixture.adapter.waitForUploadsComplete = async () => { globalThis.location.href = 'https://chatgpt.com/c/destination'; return true }
  try {
    const result = await insert(fixture, attachments)
    assert.equal(result.ok, false)
    assert.match(result.reason, /conversation changed/)
    assert.equal(fixture.adapter.sends, 0)
    assert.equal(fixture.adapter.input.value, '')
  } finally {
    globalThis.location.href = originalHref
  }
})

test('navigation before the request arrives stops it before uploading', async () => {
  const fixture = createFixture()
  const result = await insertComposerPrompt(fixture.adapter, fixture.coordinator, 'prompt', attachments, 'overwrite', true, 'https://chatgpt.com/c/other')
  assert.equal(result.ok, false)
  assert.equal(fixture.adapter.uploads, 0)
  assert.equal(fixture.adapter.sends, 0)
})

test('upload failure preserves draft for both insertion and submission', async () => {
  for (const shouldSend of [false, true]) {
    const fixture = createFixture()
    fixture.adapter.input.value = 'my draft'
    fixture.adapter.attachFiles = async () => ({ ok: false, error: 'Upload failed' })
    const result = await insert(fixture, attachments, shouldSend)
    assert.equal(result.ok, false)
    assert.equal(result.reason, 'Upload failed')
    assert.equal(fixture.adapter.input.value, 'my draft')
    assert.equal(fixture.adapter.sends, 0)
  }
})

test('new model activity during upload stops combined send without overwriting', async () => {
  const fixture = createFixture()
  fixture.adapter.input.value = 'my draft'
  fixture.adapter.waitForUploadsComplete = async () => { fixture.adapter.generating = true; return true }
  const result = await insert(fixture, attachments)
  assert.equal(result.ok, false)
  assert.match(result.reason, /model is generating/)
  assert.equal(fixture.adapter.input.value, 'my draft')
  assert.equal(fixture.adapter.sends, 0)
})

test('an exception during click preserves the uncertain send outcome', async () => {
  const fixture = createFixture()
  fixture.adapter.clickSend = () => { fixture.adapter.sends++; throw new Error('Page disappeared') }
  const result = await insert(fixture)
  assert.equal(result.ok, false)
  assert.equal(result.sendAttempted, true)
  assert.equal(fixture.adapter.sends, 1)
})

test('popup send queries one tab and sends one combined request to that tab', async () => {
  let queries = 0
  const requests = []
  globalThis.chrome = { tabs: {
    query(options, callback) { queries++; callback([{ id: queries === 1 ? 41 : 42, url: 'https://chatgpt.com/c/original' }]) },
    async sendMessage(tabId, message) { requests.push({ tabId, message }); return { type: 'INSERT_AND_SEND_PROMPT_RESULT', payload: { ok: true, sendAttempted: true } } },
  } }
  await insertAndSendPromptToTab('saved prompt', attachments)
  assert.equal(queries, 1)
  assert.equal(requests.length, 1)
  assert.equal(requests[0].tabId, 41)
  assert.equal(requests[0].message.type, 'INSERT_AND_SEND_PROMPT')
  assert.equal(requests[0].message.payload.expectedHref, 'https://chatgpt.com/c/original')
  assert.deepEqual(requests[0].message.payload.attachments, attachments)
})

test('uncertain transport failures never retry or query a second tab', async () => {
  let queries = 0
  let sends = 0
  globalThis.chrome = { tabs: {
    query(options, callback) { queries++; callback([{ id: 41, url: 'https://chatgpt.com/c/original' }]) },
    async sendMessage() { sends++; throw new Error('Message port closed') },
  } }
  await assert.rejects(insertAndSendPromptToTab('saved prompt'), /could not be confirmed.*may have been sent/)
  assert.equal(queries, 1)
  assert.equal(sends, 1)
})

test('insertion-only requests retain their action and report the actual rejection', async () => {
  let message
  globalThis.chrome = { tabs: {
    query(options, callback) { callback([{ id: 41, url: 'https://chatgpt.com/c/original' }]) },
    async sendMessage(tabId, request) { message = request; return { type: 'INJECT_PROMPT_RESULT', payload: { ok: false, reason: 'Your draft changed.' } } },
  } }
  await assert.rejects(sendPromptToTab('saved prompt'), /Your draft changed/)
  assert.equal(message.type, 'INJECT_PROMPT')
  assert.equal(message.payload.expectedHref, 'https://chatgpt.com/c/original')
})

 test('Windows line endings remain sendable after textarea normalization', async () => {
  const fixture = createFixture()
  const result = await insertComposerPrompt(fixture.adapter, fixture.coordinator, 'first\r\nsecond\r\n', [], 'overwrite', true, globalThis.location.href)
  assert.equal(result.ok, true)
  assert.equal(fixture.adapter.input.value, 'first\nsecond\n')
  assert.equal(fixture.adapter.sends, 1)
})

test('empty effective operations never insert or send an existing draft', async () => {
  for (const shouldSend of [false, true]) {
    for (const content of ['', ' \n\t']) {
      const fixture = createFixture()
      fixture.adapter.input.value = 'existing draft'
      const result = await insertComposerPrompt(fixture.adapter, fixture.coordinator, content, [], 'overwrite', shouldSend, globalThis.location.href)
      assert.equal(result.ok, false)
      assert.equal(result.sendAttempted, false)
      assert.match(result.reason, /no text or enabled attachments/)
      assert.equal(fixture.adapter.input.value, 'existing draft')
      assert.equal(fixture.adapter.sends, 0)
      assert.equal(fixture.adapter.uploads, 0)
      assert.equal(fixture.coordinator.getOwner(), null)
    }
  }
})

test('manual insertion-only never queries Send readiness', async () => {
  const fixture = createFixture()
  fixture.adapter.getSendButton = () => { throw new Error('Unexpected readiness query') }
  assert.equal((await insert(fixture, [], false)).ok, true)
  assert.equal(fixture.adapter.sends, 0)
})

test('manual send waits for readiness and keeps a draft edited during the wait', async context => {
  context.mock.timers.enable({ apis: ['Date', 'setTimeout'] })
  const fixture = createFixture()
  fixture.adapter.getSendButton = () => null
  const pending = insert(fixture)
  fixture.adapter.input.value = 'New draft'
  context.mock.timers.tick(200)
  const result = await pending
  assert.equal(result.ok, false)
  assert.equal(result.sendAttempted, false)
  assert.equal(fixture.adapter.sends, 0)
  assert.equal(fixture.adapter.input.value, 'New draft')
})

test('manual send waits for a delayed button and sends only once', async context => {
  context.mock.timers.enable({ apis: ['Date', 'setTimeout'] })
  const fixture = createFixture()
  fixture.adapter.getSendButton = () => null
  const pending = insert(fixture)
  assert.equal(fixture.adapter.sends, 0)
  fixture.adapter.getSendButton = () => ({})
  context.mock.timers.tick(200)
  assert.equal((await pending).ok, true)
  assert.equal(fixture.adapter.sends, 1)
})

test('manual send preserves uncertainty when a click throws SEND_FAILED', async () => {
  const fixture = createFixture()
  fixture.adapter.clickSend = () => { fixture.adapter.sends++; throw new Error('SEND_FAILED') }
  const result = await insert(fixture)
  assert.equal(result.ok, false)
  assert.equal(result.sendAttempted, true)
  assert.match(result.reason, /SEND_UNCERTAIN/)
  assert.equal(fixture.adapter.sends, 1)
})
