import assert from 'node:assert/strict'
import test from 'node:test'
import { sendPromptWhenReady } from '../src/content/core/queue/execution.ts'

class FakeTextarea {
  isConnected = true
  value = 'prepared prompt'
}
globalThis.HTMLTextAreaElement = FakeTextarea
globalThis.location = { href: 'https://chatgpt.com/c/test' }

function createFixture() {
  const input = new FakeTextarea()
  const controller = new AbortController()
  let attempts = 0
  const adapter = {
    input, ready: false, sends: 0, generating: false,
    getInputElement() { return this.input },
    getSendButton() { return this.ready ? {} : null },
    isGenerating() { return this.generating },
    clickSend() { this.sends++; return true },
  }
  return { adapter, input, controller, getAttempts: () => attempts, send: () => sendPromptWhenReady(adapter, input, 'prepared prompt', globalThis.location.href, () => { attempts++ }, controller.signal, { timeoutMs: 20, pollMs: 2 }) }
}

test('delayed Send availability clicks once after it becomes enabled', async context => {
  context.mock.timers.enable({ apis: ['Date', 'setTimeout'] })
  const fixture = createFixture()
  const pending = fixture.send()
  assert.equal(fixture.adapter.sends, 0)
  setTimeout(() => { fixture.adapter.ready = true }, 5)
  context.mock.timers.tick(6)
  await pending
  assert.equal(fixture.adapter.sends, 1)
  assert.equal(fixture.getAttempts(), 1)
})

test('readiness timeout never marks or attempts a send', async context => {
  context.mock.timers.enable({ apis: ['Date', 'setTimeout'] })
  const fixture = createFixture()
  const pending = fixture.send()
  context.mock.timers.tick(20)
  await assert.rejects(pending, /SEND_FAILED/)
  assert.equal(fixture.adapter.sends, 0)
  assert.equal(fixture.getAttempts(), 0)
  assert.equal(fixture.input.value, 'prepared prompt')
})

for (const cause of ['cancel', 'navigation', 'draft', 'input', 'detached', 'generation']) {
  test(`readiness stops before clicking after ${cause}`, async () => {
    const fixture = createFixture()
    const href = globalThis.location.href
    const pending = fixture.send()
    if (cause === 'cancel') fixture.controller.abort()
    if (cause === 'navigation') globalThis.location.href += '/changed'
    if (cause === 'draft') fixture.input.value = 'New draft'
    if (cause === 'input') fixture.adapter.input = new FakeTextarea()
    if (cause === 'detached') fixture.input.isConnected = false
    if (cause === 'generation') fixture.adapter.generating = true
    fixture.adapter.ready = true
    try {
      await assert.rejects(pending)
      assert.equal(fixture.adapter.sends, 0)
      assert.equal(fixture.getAttempts(), 0)
      if (cause === 'draft') assert.equal(fixture.input.value, 'New draft')
    } finally { globalThis.location.href = href }
  })
}

test('composer context is checked again after button discovery', async () => {
  const fixture = createFixture()
  fixture.adapter.getSendButton = () => { fixture.input.value = 'New draft'; return {} }
  await assert.rejects(fixture.send(), /COMPOSER_CHANGED/)
  assert.equal(fixture.adapter.sends, 0)
})

test('button disappearing before click is a definite unsent failure', async () => {
  const fixture = createFixture()
  fixture.adapter.ready = true
  fixture.adapter.clickSend = () => false
  await assert.rejects(fixture.send(), /^Error: SEND_FAILED$/)
  assert.equal(fixture.adapter.sends, 0)
})

test('a click throwing SEND_FAILED retains uncertainty and is never repeated', async () => {
  const fixture = createFixture()
  fixture.adapter.ready = true
  fixture.adapter.clickSend = () => { fixture.adapter.sends++; throw new Error('SEND_FAILED') }
  await assert.rejects(fixture.send(), /SEND_UNCERTAIN/)
  assert.equal(fixture.adapter.sends, 1)
  assert.equal(fixture.getAttempts(), 1)
})
