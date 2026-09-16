import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import * as requests from '../src/messaging/transport.ts';

const require = createRequire(resolve('package.json'));
const ts = require('typescript');
const settle = () => new Promise(resolve => setImmediate(resolve));

function createController() {
  const loads = [];
  const notices = [];
  const inserted = [];
  const queued = [];
  const chains = [];
  const shown = [];
  const events = {};
  const input = { value: 'My draft' };
  let receiver;
  let changeSettings;
  let selection;
  let searchFailed = false;
  let chainVersion = 0;
  let queueVersion = 0;
  let cancelQueue;
  const dependencies = {
    './prompt_editor/prompt_editor': { createEditor: () => ({}) },
    './prompt_overlay': { createOverlay(callbacks) { selection = callbacks.onSelect; return { isOpen: () => false, hide() {}, show(...args) { shown.push(args); } }; } },
    './execution/queue': { createQueue: () => ({ enqueue(item) { queued.push(item); return true; }, cancel() { queueVersion++; }, getCancellationVersion: () => queueVersion }) },
    './execution/chain_executor': { createChainExecutor: () => ({ isRunning: () => false, run(...args) { chains.push(args); }, cancel() { chainVersion++; }, getCancellationVersion: () => chainVersion }) },
    './execution/status_panel': { createQueuePanel(queue) { cancelQueue = queue.cancel; return { showMessage(message) { notices.push(message); } }; } },
    './execution/step_execution': { getConversationHref: () => 'https://chatgpt.com/c/current', isConversationReady: () => true, createExecutionCoordinator: () => ({ isBusy: () => false }) },
    './library_client': {
      getSettings: () => new Promise((resolve, reject) => loads.push({ resolve, reject })),
      searchPrompts: async () => {
        if (searchFailed) {
          throw new Error('read failed');
        }
        return [];
      },
      searchChains: async () => [],
      logUsage: async () => { throw new Error('usage failed'); },
    },
    './page_tweaks': { applyTweaks() {} },
    './composer/composer_text': { getInputText: input => input.value, setInputText(input, text) { input.value = text; } },
    './composer/insert_prompt': { async insertComposerPrompt(...args) { inserted.push(args); return { ok: true }; } },
    './shortcut_trigger': { detectShortcutContext: () => ({ query: '', rect: {} }) },
    '../messaging/transport': requests,
  };
  const exports = {};
  vm.runInNewContext(ts.transpileModule(readFileSync(resolve('src/content/controller.ts'), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, {
    exports, Error, document: { documentElement: {}, addEventListener(name, callback) { events[name] = callback; } },
    window: { addEventListener() {} }, MutationObserver: class { observe() {} },
    chrome: { runtime: { sendMessage: async () => {}, onMessage: { addListener(fn) { receiver = fn; } } }, storage: { onChanged: { addListener(fn) { changeSettings = fn; } } } },
    require: name => dependencies[name] || {},
  });
  exports.initController({ id: 'chatgpt', getInputElement: () => input, isGenerating: () => true });
  return {
    loads, notices, inserted, queued, shown, input, chains,
    runChain() { return new Promise(resolve => receiver({ type: 'RUN_CHAIN', payload: { steps: [{ content: 'Private' }], expectedHref: 'https://chatgpt.com/c/current' } }, {}, resolve)); },
    cancelChain() { return new Promise(resolve => receiver({ type: 'CANCEL_CHAIN' }, {}, resolve)); },
    cancelQueue() { cancelQueue(); },
    receive() { return new Promise(resolve => receiver({ type: 'INJECT_PROMPT', payload: { content: 'Private', attachments: [{ id: 'file' }], expectedHref: 'https://chatgpt.com/c/current' } }, {}, resolve)); },
    select() { selection({ kind: 'prompt', id: 'p', content: 'Private', attachments: [{ id: 'file' }] }); },
    selectChain() { selection({ kind: 'chain', steps: [{ content: 'Private' }] }); },
    enter() { events.keydown({ isTrusted: true, key: 'Enter', target: input, preventDefault() {} }); },
    search(failed) { searchFailed = failed; events.input({ isTrusted: true, target: input }); },
    invalidate() { changeSettings({ langqueue_settings: {} }, 'local'); },
  };
}

test('failed settings keep the draft and require another explicit action before insertion', async () => {
  const fixture = createController();
  fixture.loads[0].reject(new Error('unavailable'));
  await settle();
  const failed = fixture.receive();
  fixture.loads[1].reject(new Error('unavailable'));
  assert.equal((await failed).result.ok, false);
  assert.match(fixture.notices.at(-1), /Details: unavailable/);
  assert.equal(fixture.input.value, 'My draft');
  assert.equal(fixture.inserted.length, 0);
  const retried = fixture.receive();
  fixture.loads[2].resolve({ multimodalEnabled: false });
  assert.equal((await retried).result.ok, true);
  assert.equal(fixture.inserted.length, 1);
  assert.equal(fixture.inserted[0][3].length, 0);
});

test('manual and overlay selections refuse a draft changed during settings loading', async () => {
  for (const action of ['receive', 'select']) {
    const fixture = createController();
    const pending = fixture[action]();
    fixture.input.value = 'New draft';
    fixture.loads[0].resolve({});
    await pending;
    await settle();
    assert.equal(fixture.inserted.length, 0);
    assert.equal(fixture.input.value, 'New draft');
  }
});

test('queued Enter preserves a draft on read failure and only retries on another Enter', async () => {
  const fixture = createController();
  fixture.enter();
  fixture.loads[0].reject(new Error('unavailable'));
  await settle();
  assert.equal(fixture.queued.length, 0);
  assert.equal(fixture.input.value, 'My draft');
  fixture.enter();
  fixture.loads[1].resolve({});
  await settle();
  assert.equal(fixture.queued.length, 1);
  assert.equal(fixture.input.value, '');
});

test('search failure displays an error while successful empty search remains empty', async () => {
  const fixture = createController();
  fixture.loads[0].resolve({});
  fixture.search(true);
  await settle();
  assert.equal(fixture.shown.length, 0);
  assert.match(fixture.notices.at(-1), /library could not be loaded/);
  assert.match(fixture.notices.at(-1), /Details: read failed/);
  fixture.search(false);
  await settle();
  assert.equal(fixture.shown.length, 1);
  assert.equal(fixture.shown[0][1].length, 0);
});

test('usage failure reports success of insertion without retrying it', async () => {
  const fixture = createController();
  fixture.loads[0].resolve({});
  await settle();
  fixture.select();
  await settle();
  assert.equal(fixture.inserted.length, 1);
  assert.match(fixture.notices.at(-1), /prompt was inserted.*usage count could not be saved/);
});

test('a stale settings read cannot overwrite a newer disabled-attachments preference', async () => {
  const fixture = createController();
  fixture.invalidate();
  fixture.loads[1].resolve({ multimodalEnabled: false });
  await settle();
  fixture.loads[0].resolve({ multimodalEnabled: true });
  await settle();
  assert.equal((await fixture.receive()).result.ok, true);
  assert.equal(fixture.inserted[0][3].length, 0);
});

test('chain start refuses a draft changed during settings loading', async () => {
  const fixture = createController();
  const pending = fixture.runChain();
  fixture.input.value = 'New draft';
  fixture.loads[0].resolve({});
  assert.equal((await pending).result.reason, 'COMPOSER_CHANGED');
  assert.equal(fixture.chains.length, 0);
  assert.equal(fixture.input.value, 'New draft');
});

test('cancel prevents pending chain starts after settings resolve but allows a new request', async () => {
  const fixture = createController();
  const pending = [fixture.runChain(), fixture.runChain()];
  assert.equal((await fixture.cancelChain()).ok, true);
  fixture.loads[0].resolve({});
  for (const response of await Promise.all(pending)) {
    assert.equal(response.result.ok, false);
    assert.equal(response.result.reason, 'CANCELLED');
  }
  assert.equal(fixture.chains.length, 0);
  assert.equal(fixture.input.value, 'My draft');
  assert.equal((await fixture.runChain()).result.ok, true);
  assert.equal(fixture.chains.length, 1);
});

test('queue cancellation preserves a draft awaiting settings and allows a later Enter', async () => {
  const fixture = createController();
  fixture.enter();
  fixture.cancelQueue();
  fixture.loads[0].resolve({});
  await settle();
  assert.equal(fixture.queued.length, 0);
  assert.equal(fixture.input.value, 'My draft');
  fixture.enter();
  await settle();
  assert.equal(fixture.queued.length, 1);
  assert.equal(fixture.input.value, '');
});

test('chain cancellation invalidates an overlay selection awaiting settings', async () => {
  const fixture = createController();
  fixture.selectChain();
  await fixture.cancelChain();
  fixture.loads[0].resolve({});
  await settle();
  assert.equal(fixture.chains.length, 0);
  assert.equal(fixture.input.value, 'My draft');
  fixture.selectChain();
  await settle();
  assert.equal(fixture.chains.length, 1);
});
