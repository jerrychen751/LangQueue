import test from 'node:test'
import assert from 'node:assert/strict'
import { executeStep, createExecutionCoordinator } from '../src/content/core/queue/execution.ts'
import { createChainExecutor } from '../src/content/core/queue/chain_executor.ts'
import { createQueue } from '../src/content/core/queue/queue.ts'

class FakeTextarea {
  storedValue = ''
  get value() { return this.storedValue }
  set value(value) { this.storedValue = value }
  disabled = false
  offsetParent = {}
  focus() {}
  dispatchEvent() {}
}
globalThis.HTMLTextAreaElement = FakeTextarea
globalThis.location = { href: 'https://chatgpt.com/c/test-conversation' }

function createAdapter() {
  const input = new FakeTextarea()
  return {
    input,
    sends: 0,
    generating: false,
    getInputElement() { return input },
    isGenerating() { return this.generating },
    clickSend() { this.sends++; return true },
    attachFiles: async () => ({ ok: true }),
    waitForUploadsComplete: async () => true,
  }
}

const timing = { timeoutMs: 30, startTimeoutMs: 30, pollMs: 2 }

function runStep(adapter, signal = new AbortController().signal) {
  return executeStep(adapter, () => adapter.input, { content: 'prompt' }, 'overwrite', signal, () => {}, () => {}, timing)
}

test('waits for delayed generation before completing', async () => {
  const adapter = createAdapter()
  adapter.clickSend = () => {
    adapter.sends++
    setTimeout(() => { adapter.generating = true }, 5)
    setTimeout(() => { adapter.generating = false }, 15)
    return true
  }
  const start = Date.now()
  await runStep(adapter)
  assert.ok(Date.now() - start >= 12)
  assert.equal(adapter.sends, 1)
})

test('fails when generation never starts', async () => {
  await assert.rejects(runStep(createAdapter()), /GENERATION_START_TIMEOUT/)
})

test('fails when generation never completes', async () => {
  const adapter = createAdapter()
  adapter.clickSend = () => { adapter.generating = true; return true }
  await assert.rejects(runStep(adapter), /RESPONSE_TIMEOUT/)
})

test('cancels idle waits before sending', async () => {
  const adapter = createAdapter()
  adapter.generating = true
  const controller = new AbortController()
  const pending = runStep(adapter, controller.signal)
  controller.abort()
  await assert.rejects(pending, { name: 'AbortError' })
  assert.equal(adapter.sends, 0)
})

test('reports send failure', async () => {
  const adapter = createAdapter()
  adapter.clickSend = () => false
  await assert.rejects(runStep(adapter), /SEND_FAILED/)
})

test('blocks chains when queue has pending work', async () => {
  const coordinator = createExecutionCoordinator()
  coordinator.setQueuePending(1)
  const chain = createChainExecutor(createAdapter(), () => null, coordinator)
  assert.equal(await chain.run([{ content: 'prompt' }], {}), false)
  assert.equal(chain.getSnapshot().error, 'COMPOSER_BUSY')
})

test('queue waits for the chain composer lock and allows removal', async () => {
  const coordinator = createExecutionCoordinator()
  coordinator.tryAcquire('chain')
  const adapter = createAdapter()
  const queue = createQueue(adapter, () => adapter.input, coordinator)
  queue.enqueue({ content: 'prompt' })
  assert.equal(queue.getSnapshot().status, 'waiting')
  assert.equal(adapter.sends, 0)
  queue.remove(queue.getSnapshot().items[0].id)
  coordinator.release()
  assert.equal(queue.size(), 0)
})

test('cancelling an upload prevents send and keeps the composer locked until upload settles', async () => {
  globalThis.chrome = { runtime: { sendMessage: async message => message.type === 'ATTACHMENT_GET_CHUNK' ? {
    type: 'ATTACHMENT_GET_CHUNK_RESULT', payload: { ok: true, chunkBase64: '', nextOffset: 0, totalBytes: 0, done: true },
  } : undefined } }
  const adapter = createAdapter()
  let finishUpload
  let markUploading
  const uploading = new Promise(resolve => { markUploading = resolve })
  adapter.waitForUploadsComplete = () => { markUploading(); return new Promise(resolve => { finishUpload = resolve }) }
  const coordinator = createExecutionCoordinator()
  const chain = createChainExecutor(adapter, () => adapter.input, coordinator)
  const pending = chain.run([{ content: 'prompt', attachments: [{ id: 'fixture', name: 'empty.txt', mimeType: 'text/plain' }] }], {})
  await uploading
  chain.cancel()
  assert.equal(coordinator.getOwner(), 'chain')
  assert.equal(coordinator.tryAcquire('manual'), false)
  finishUpload(true)
  assert.equal(await pending, false)
  assert.equal(chain.getSnapshot().status, 'cancelled')
  assert.equal(adapter.sends, 0)
  assert.equal(coordinator.getOwner(), null)
})

test('queue exposes errors and allows retry after send was rejected', async () => {
  const adapter = createAdapter()
  adapter.clickSend = () => false
  const queue = createQueue(adapter, () => adapter.input)
  queue.enqueue({ content: 'prompt' })
  await new Promise(resolve => setTimeout(resolve, 0))
  assert.equal(queue.getSnapshot().error, 'SEND_FAILED')
  assert.equal(queue.getSnapshot().canRetry, true)
  queue.cancel()
})

test('queue prevents retry after a send throws with uncertain outcome', async () => {
  const adapter = createAdapter()
  adapter.clickSend = () => { throw new Error('Page disappeared') }
  const queue = createQueue(adapter, () => adapter.input)
  queue.enqueue({ content: 'prompt' })
  await new Promise(resolve => setTimeout(resolve, 0))
  assert.equal(queue.getSnapshot().items[0].sent, true)
  assert.equal(queue.getSnapshot().canRetry, false)
  queue.cancel()
})

test('chain timeout stops before the next step and publishes a settled terminal state', async context => {
  context.mock.timers.enable({ apis: ['Date', 'setTimeout'] })
  const adapter = createAdapter()
  adapter.clickSend = () => { adapter.sends++; adapter.generating = true; return true }
  const chain = createChainExecutor(adapter, () => adapter.input)
  let terminalRunning
  chain.subscribe(snapshot => { if (snapshot.status === 'error') terminalRunning = chain.isRunning() })
  const pending = chain.run([{ content: 'first' }, { content: 'second' }], {})
  context.mock.timers.tick(120001)
  assert.equal(await pending, false)
  assert.match(chain.getSnapshot().error, /RESPONSE_TIMEOUT/)
  assert.equal(adapter.sends, 1)
  assert.equal(terminalRunning, false)
})

test('queue response timeout keeps the sent item and stops later work', async context => {
  context.mock.timers.enable({ apis: ['Date', 'setTimeout'] })
  const adapter = createAdapter()
  adapter.clickSend = () => { adapter.sends++; adapter.generating = true; return true }
  const queue = createQueue(adapter, () => adapter.input)
  queue.enqueue({ content: 'first' })
  queue.enqueue({ content: 'second' })
  context.mock.timers.tick(1800001)
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
  assert.equal(queue.getSnapshot().status, 'failed')
  assert.equal(queue.size(), 2)
  assert.equal(queue.getSnapshot().canRetry, false)
  assert.equal(adapter.sends, 1)
  queue.cancel()
})

test('cancel removes an unsent active queue item after the wait aborts', async () => {
  const adapter = createAdapter()
  adapter.generating = true
  const queue = createQueue(adapter, () => adapter.input)
  queue.enqueue({ content: 'first' })
  queue.cancel()
  await new Promise(resolve => setTimeout(resolve, 0))
  assert.equal(queue.size(), 0)
  assert.equal(queue.getSnapshot().running, false)
  assert.equal(adapter.sends, 0)
})

test('queue preserves a draft typed while waiting for the model', async context => {
  context.mock.timers.enable({ apis: ['Date', 'setTimeout'] })
  const adapter = createAdapter()
  adapter.generating = true
  const queue = createQueue(adapter, () => adapter.input)
  queue.enqueue({ content: 'queued prompt' })
  adapter.input.value = 'new draft'
  adapter.generating = false
  context.mock.timers.tick(200)
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
  assert.equal(adapter.input.value, 'new draft')
  assert.equal(adapter.sends, 0)
  assert.match(queue.getSnapshot().error, /COMPOSER_CHANGED/)
  assert.equal(queue.getSnapshot().canRetry, true)
  queue.cancel()
})

test('queue refuses a pre-existing draft when it acquires the composer', async () => {
  const adapter = createAdapter()
  adapter.input.value = 'unsent draft'
  const queue = createQueue(adapter, () => adapter.input)
  queue.enqueue({ content: 'queued prompt' })
  await Promise.resolve()
  assert.equal(adapter.input.value, 'unsent draft')
  assert.equal(adapter.sends, 0)
  assert.match(queue.getSnapshot().error, /COMPOSER_CHANGED/)
  queue.cancel()
})

test('chain preserves a draft changed during attachment upload', async () => {
  const adapter = createAdapter()
  adapter.input.value = 'initial draft'
  adapter.waitForUploadsComplete = async () => { adapter.input.value = 'edited draft'; return true }
  const chain = createChainExecutor(adapter, () => adapter.input)
  assert.equal(await chain.run([{ content: 'prompt', attachments: [{ id: 'fixture', name: 'empty.txt', mimeType: 'text/plain' }] }], {}), false)
  assert.equal(adapter.input.value, 'edited draft')
  assert.equal(adapter.sends, 0)
  assert.match(chain.getSnapshot().error, /COMPOSER_CHANGED/)
})

test('queue still waits after two minutes before sending or completing', async context => {
  context.mock.timers.enable({ apis: ['Date', 'setTimeout'] })
  const adapter = createAdapter()
  adapter.generating = true
  const queue = createQueue(adapter, () => adapter.input)
  queue.enqueue({ content: 'prompt' })
  context.mock.timers.tick(120001)
  await Promise.resolve()
  await Promise.resolve()
  assert.equal(queue.getSnapshot().status, 'waiting')
  adapter.generating = false
  adapter.clickSend = () => { adapter.generating = true; adapter.sends++; return true }
  context.mock.timers.tick(200)
  await Promise.resolve()
  await Promise.resolve()
  context.mock.timers.tick(120001)
  await Promise.resolve()
  await Promise.resolve()
  assert.equal(queue.getSnapshot().status, 'awaiting_response')
  queue.cancel()
  await Promise.resolve()
  await Promise.resolve()
})

test('chain publishes its terminal event exactly once after settling', async () => {
  const previousChrome = globalThis.chrome
  const statuses = []
  globalThis.chrome = { runtime: { sendMessage: async message => { statuses.push(message.payload.status) } } }
  try {
    const adapter = createAdapter()
    adapter.clickSend = () => false
    const chain = createChainExecutor(adapter, () => adapter.input)
    const runningAtError = []
    chain.subscribe(progress => { if (progress.status === 'error') runningAtError.push(chain.isRunning()) })
    assert.equal(await chain.run([{ content: 'prompt' }], {}), false)
    assert.deepEqual(statuses.filter(status => status === 'error'), ['error'])
    assert.deepEqual(runningAtError, [false])
  } finally {
    globalThis.chrome = previousChrome
  }
})

test('queue rejects new work during cancellation and accepts it after draining', async () => {
  const adapter = createAdapter()
  adapter.generating = true
  const queue = createQueue(adapter, () => adapter.input)
  assert.equal(queue.enqueue({ content: 'first' }), true)
  queue.cancel()
  assert.equal(queue.enqueue({ content: 'second' }), false)
  await new Promise(resolve => setTimeout(resolve, 0))
  assert.equal(queue.size(), 0)
  assert.equal(queue.enqueue({ content: 'second' }), true)
  queue.cancel()
  await new Promise(resolve => setTimeout(resolve, 0))
})

test('cancelled uploads leave a dismissible cleanup warning after the item is removed', async () => {
  const adapter = createAdapter()
  let finishUpload
  let markUploading
  const uploading = new Promise(resolve => { markUploading = resolve })
  adapter.waitForUploadsComplete = () => { markUploading(); return new Promise(resolve => { finishUpload = resolve }) }
  const queue = createQueue(adapter, () => adapter.input)
  queue.enqueue({ content: 'prompt', attachments: [{ id: 'fixture', name: 'empty.txt', mimeType: 'text/plain' }] })
  await uploading
  queue.cancel()
  assert.equal(queue.enqueue({ content: 'next' }), false)
  finishUpload(true)
  await new Promise(resolve => setTimeout(resolve, 0))
  assert.equal(queue.size(), 0)
  assert.equal(queue.getSnapshot().error, 'QUEUE_CANCELLED_ATTACHMENTS')
  queue.clearError()
  assert.equal(queue.getSnapshot().error, null)
})

test('queue preserves its item and never sends into a different conversation', async context => {
  context.mock.timers.enable({ apis: ['Date', 'setTimeout'] })
  const previousLocation = globalThis.location
  globalThis.location = { href: 'https://chatgpt.com/c/original' }
  try {
    const adapter = createAdapter()
    adapter.generating = true
    const queue = createQueue(adapter, () => adapter.input)
    queue.enqueue({ content: 'original conversation prompt' })
    globalThis.location.href = 'https://chatgpt.com/c/different'
    adapter.generating = false
    context.mock.timers.tick(200)
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
    assert.equal(adapter.sends, 0)
    assert.equal(queue.size(), 1)
    assert.equal(queue.getSnapshot().error, 'CONVERSATION_CHANGED')
    assert.equal(queue.getSnapshot().canRetry, false)
    queue.retry()
    assert.equal(adapter.sends, 0)
    queue.cancel()
  } finally {
    globalThis.location = previousLocation
  }
})

test('navigation during uploads stops chain sends after upload drains', async () => {
  const previousLocation = globalThis.location
  globalThis.location = { href: 'https://chatgpt.com/c/original' }
  try {
    const adapter = createAdapter()
    adapter.waitForUploadsComplete = async () => { globalThis.location.href = 'https://chatgpt.com/c/different'; return true }
    const chain = createChainExecutor(adapter, () => adapter.input)
    assert.equal(await chain.run([{ content: 'prompt', attachments: [{ id: 'fixture', name: 'empty.txt', mimeType: 'text/plain' }] }], {}), false)
    assert.equal(adapter.sends, 0)
    assert.equal(chain.getSnapshot().error, 'CONVERSATION_CHANGED')
  } finally {
    globalThis.location = previousLocation
  }
})

test('chain preserves drafts entered between steps', async context => {
  context.mock.timers.enable({ apis: ['Date', 'setTimeout'] })
  const adapter = createAdapter()
  let generationReads = 0
  adapter.isGenerating = () => generationReads-- > 0
  adapter.clickSend = () => { adapter.sends++; adapter.input.value = ''; generationReads = 1; return true }
  const chain = createChainExecutor(adapter, () => adapter.input)
  chain.subscribe(progress => { if (progress.status === 'delayed') adapter.input.value = 'my new draft' })
  const pending = chain.run([{ content: 'first' }, { content: 'second' }], {})
  await Promise.resolve()
  context.mock.timers.tick(1500)
  assert.equal(await pending, false)
  assert.equal(adapter.input.value, 'my new draft')
  assert.equal(adapter.sends, 1)
  assert.match(chain.getSnapshot().error, /COMPOSER_CHANGED/)
})

test('chain stops on navigation during its inter-step delay', async context => {
  context.mock.timers.enable({ apis: ['Date', 'setTimeout'] })
  const previousLocation = globalThis.location
  globalThis.location = { href: 'https://chatgpt.com/c/original' }
  try {
    const adapter = createAdapter()
    let generationReads = 0
    adapter.isGenerating = () => generationReads-- > 0
    adapter.clickSend = () => { adapter.sends++; adapter.input.value = ''; generationReads = 1; return true }
    const chain = createChainExecutor(adapter, () => adapter.input)
    chain.subscribe(progress => { if (progress.status === 'delayed') globalThis.location.href = 'https://chatgpt.com/c/different' })
    const pending = chain.run([{ content: 'first' }, { content: 'second' }], {})
    await Promise.resolve()
    context.mock.timers.tick(1500)
    assert.equal(await pending, false)
    assert.equal(adapter.sends, 1)
    assert.match(chain.getSnapshot().error, /CONVERSATION_CHANGED/)
  } finally {
    globalThis.location = previousLocation
  }
})

for (const href of [
  'https://chatgpt.com/',
  'https://chatgpt.com/?temporary-chat=true',
  'https://chatgpt.com/g/example-gpt',
  'https://claude.ai/new',
  'https://claude.ai/project/example-project',
  'https://gemini.google.com/',
  'https://gemini.google.com/app',
]) {
  test(`fresh chat refuses queue and chain without changing its draft: ${href}`, async () => {
    const previousLocation = globalThis.location
    globalThis.location = { href }
    try {
      const adapter = createAdapter()
      adapter.input.value = 'my first message'
      const queue = createQueue(adapter, () => adapter.input)
      assert.equal(queue.enqueue({ content: 'queued prompt' }), false)
      assert.equal(queue.size(), 0)
      assert.equal(queue.getSnapshot().error, 'CONVERSATION_REQUIRED')
      const chain = createChainExecutor(adapter, () => adapter.input)
      assert.equal(await chain.run([{ content: 'first step' }], {}), false)
      assert.equal(chain.getSnapshot().error, 'CONVERSATION_REQUIRED')
      assert.equal(adapter.input.value, 'my first message')
      assert.equal(adapter.sends, 0)
      await assert.rejects(runStep(adapter), /CONVERSATION_REQUIRED/)
      assert.equal(adapter.input.value, 'my first message')
    } finally {
      globalThis.location = previousLocation
    }
  })
}

for (const href of [
  'https://chatgpt.com/c/existing-conversation',
  'https://chat.openai.com/c/existing-conversation',
  'https://chatgpt.com/g/example-gpt/c/existing-conversation',
  'https://claude.ai/chat/existing-conversation',
  'https://gemini.google.com/app/existing-conversation',
]) {
  test(`established conversation still starts execution: ${href}`, async () => {
    const previousLocation = globalThis.location
    globalThis.location = { href }
    try {
      const adapter = createAdapter()
      let generationReads = 0
      adapter.isGenerating = () => generationReads-- > 0
      adapter.clickSend = () => { adapter.sends++; adapter.input.value = ''; generationReads = 1; return true }
      const chain = createChainExecutor(adapter, () => adapter.input)
      assert.equal(await chain.run([{ content: 'prompt' }], {}), true)
      assert.equal(adapter.sends, 1)
    } finally {
      globalThis.location = previousLocation
    }
  })
}

test('a fresh-chat rejection recovers when new work is queued in an established conversation', async () => {
  const previousLocation = globalThis.location
  globalThis.location = { href: 'https://chatgpt.com/' }
  try {
    const adapter = createAdapter()
    let generationReads = 0
    adapter.isGenerating = () => generationReads-- > 0
    adapter.clickSend = () => { adapter.sends++; adapter.input.value = ''; generationReads = 1; return true }
    const queue = createQueue(adapter, () => adapter.input)
    assert.equal(queue.enqueue({ content: 'rejected prompt' }), false)
    assert.equal(queue.getSnapshot().error, 'CONVERSATION_REQUIRED')
    globalThis.location.href = 'https://chatgpt.com/c/established'
    queue.stopForNavigation()
    assert.equal(queue.enqueue({ content: 'new prompt' }), true)
    await new Promise(resolve => setTimeout(resolve, 0))
    assert.equal(adapter.sends, 1)
    assert.equal(queue.getSnapshot().status, 'idle')
    assert.equal(queue.getSnapshot().error, null)
    assert.equal(queue.size(), 0)
  } finally {
    globalThis.location = previousLocation
  }
})

test('adding new work does not reset an existing failed queue item', async () => {
  const adapter = createAdapter()
  adapter.clickSend = () => { adapter.sends++; return false }
  const queue = createQueue(adapter, () => adapter.input)
  queue.enqueue({ content: 'failed prompt' })
  await new Promise(resolve => setTimeout(resolve, 0))
  assert.equal(queue.getSnapshot().status, 'failed')
  queue.enqueue({ content: 'next prompt' })
  assert.equal(queue.getSnapshot().status, 'failed')
  assert.equal(queue.getSnapshot().error, 'SEND_FAILED')
  assert.equal(queue.size(), 2)
  assert.equal(adapter.sends, 1)
  queue.cancel()
})
