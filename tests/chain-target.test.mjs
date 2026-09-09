import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import test from 'node:test'
import vm from 'node:vm'
import { runChainOnTab } from '../src/utils/messaging.ts'

const require = createRequire(resolve('package.json'))
const ts = require('typescript')

function createReceiver() {
  let receiver
  let starts = 0
  const exports = {}
  const dependencies = {
    './editor/editor': { createEditor: () => ({}) },
    './overlay/overlay': { createOverlay: () => ({}) },
    './queue/queue': { createQueue: () => ({}) },
    './queue/chain_executor': { createChainExecutor: () => ({ run() { starts++ } }) },
    './queue/panel': { createQueuePanel: () => ({}) },
    './queue/execution': { getConversationHref: () => 'https://chatgpt.com/c/current', isConversationReady: () => true, createExecutionCoordinator: () => ({ isBusy: () => false }) },
    './messaging': { getSettings: async () => ({}) },
    './page_tweaks/tweaks': { applyTweaks() {} },
  }
  vm.runInNewContext(ts.transpileModule(readFileSync(resolve('src/content/core/controller.ts'), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, {
    exports, document: { documentElement: {}, addEventListener() {} }, window: { addEventListener() {} },
    MutationObserver: class { observe() {} },
    chrome: { runtime: { sendMessage: async () => {}, onMessage: { addListener(listener) { receiver = listener } } }, storage: { onChanged: { addListener() {} } } },
    require(name) { return dependencies[name] || {} },
  })
  exports.initController({ getInputElement: () => null })
  return { receive(payload) { let response; receiver({ type: 'RUN_CHAIN', payload }, {}, value => { response = value }); return response }, getStarts: () => starts }
}

test('chain receiver refuses missing and changed target URLs before starting', () => {
  const fixture = createReceiver()
  for (const expectedHref of [undefined, 'https://chatgpt.com/c/original']) {
    const response = fixture.receive({ steps: [{ content: 'private' }], expectedHref })
    assert.equal(response.ok, false)
    assert.equal(response.reason, 'CONVERSATION_CHANGED')
  }
  assert.equal(fixture.getStarts(), 0)
  assert.equal(fixture.receive({ steps: [{ content: 'private' }], expectedHref: 'https://chatgpt.com/c/current' }).ok, true)
  assert.equal(fixture.getStarts(), 1)
})

test('chain caller pins the original tab and URL across readiness checks', async () => {
  let queries = 0
  const messages = []
  globalThis.chrome = { tabs: {
    query(options, callback) { queries++; callback([{ id: 12, url: 'https://chatgpt.com/c/original' }]) },
    async sendMessage(id, message) { messages.push({ id, message }); return message.type === 'COMPAT_CHECK' ? { type: 'COMPAT_STATUS', payload: { ready: true } } : { ok: false, reason: 'CONVERSATION_CHANGED' } },
  } }
  await assert.rejects(runChainOnTab([{ content: 'private' }]), /conversation changed before the chain started/)
  assert.equal(queries, 1)
  assert.deepEqual(messages.map(item => item.id), [12, 12])
  assert.equal(messages[1].message.payload.expectedHref, 'https://chatgpt.com/c/original')
})
