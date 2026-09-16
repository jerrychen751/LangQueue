import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import test from 'node:test'
import vm from 'node:vm'
import { runChainOnTab } from '../src/popup/activeTab.ts'
import * as requests from '../src/messaging/transport.ts'

const require = createRequire(resolve('package.json'))
const ts = require('typescript')

function createReceiver() {
  let receiver
  let starts = 0
  const exports = {}
  const dependencies = {
    './prompt_editor/prompt_editor': { createEditor: () => ({}) },
    './prompt_overlay': { createOverlay: () => ({}) },
    './execution/queue': { createQueue: () => ({}) },
    './execution/chain_executor': { createChainExecutor: () => ({ run() { starts++ }, getCancellationVersion: () => 0 }) },
    './execution/status_panel': { createQueuePanel: () => ({}) },
    './execution/step_execution': { getConversationHref: () => 'https://chatgpt.com/c/current', isConversationReady: () => true, createExecutionCoordinator: () => ({ isBusy: () => false }) },
    './library_client': { getSettings: async () => ({}) },
    './page_tweaks': { applyTweaks() {} },
    '../messaging/transport': requests,
  }
  vm.runInNewContext(ts.transpileModule(readFileSync(resolve('src/content/controller.ts'), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, {
    exports, document: { documentElement: {}, addEventListener() {} }, window: { addEventListener() {} },
    MutationObserver: class { observe() {} },
    chrome: { runtime: { sendMessage: async () => {}, onMessage: { addListener(listener) { receiver = listener } } }, storage: { onChanged: { addListener() {} } } },
    require(name) { return dependencies[name] || {} },
  })
  exports.initController({ getInputElement: () => null })
  return { receive(payload) { return new Promise(resolve => receiver({ type: 'RUN_CHAIN', payload }, {}, resolve)) }, getStarts: () => starts }
}

test('chain receiver refuses missing and changed target URLs before starting', async () => {
  const fixture = createReceiver()
  for (const expectedHref of [undefined, 'https://chatgpt.com/c/original']) {
    const response = await fixture.receive({ steps: [{ content: 'private' }], expectedHref })
    assert.equal(response.result.ok, false)
    assert.equal(response.result.reason, 'CONVERSATION_CHANGED')
  }
  assert.equal(fixture.getStarts(), 0)
  assert.equal((await fixture.receive({ steps: [{ content: 'private' }], expectedHref: 'https://chatgpt.com/c/current' })).result.ok, true)
  assert.equal(fixture.getStarts(), 1)
})

test('chain caller pins the original tab and URL across readiness checks', async () => {
  let queries = 0
  const messages = []
  globalThis.chrome = { tabs: {
    query(options, callback) { queries++; callback([{ id: 12, url: 'https://chatgpt.com/c/original' }]) },
    async sendMessage(id, message) { messages.push({ id, message }); return message.type === 'COMPAT_CHECK' ? { ok: true, result: { ready: true } } : { ok: true, result: { ok: false, reason: 'CONVERSATION_CHANGED' } } },
  } }
  await assert.rejects(runChainOnTab([{ content: 'private' }]), /conversation changed before the chain started/)
  assert.equal(queries, 1)
  assert.deepEqual(messages.map(item => item.id), [12, 12])
  assert.equal(messages[1].message.payload.expectedHref, 'https://chatgpt.com/c/original')
})

test('chain caller explains settings and changed draft failures', async () => {
  for (const [reason, expected] of [['SETTINGS_UNAVAILABLE', /Settings are unavailable.*reload settings/], ['COMPOSER_CHANGED', /draft changed.*Start the chain again/], ['CANCELLED', /cancelled before it started.*draft was kept/]]) {
    globalThis.chrome = { tabs: {
      query(options, callback) { callback([{ id: 12, url: 'https://chatgpt.com/c/original' }]) },
      async sendMessage(id, message) { return message.type === 'COMPAT_CHECK' ? { ok: true, result: { ready: true } } : { ok: true, result: { ok: false, reason } } },
    } }
    await assert.rejects(runChainOnTab([{ content: 'private' }]), expected)
  }
})
