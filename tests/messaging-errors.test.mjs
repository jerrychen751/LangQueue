import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import test from 'node:test';
import vm from 'node:vm';

const require = createRequire(resolve('package.json'));
const ts = require('typescript');

function loadModule(path, context) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(readFileSync(resolve(path), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, { exports, Error, ...context });
  return exports;
}

function createMessaging() {
  let receiver;
  let failed = false;
  const storage = Object.fromEntries(['getSettings', 'searchPrompts', 'searchChains', 'logUsage'].map(name => [name, async () => {
    if (failed) {
      throw new Error('Storage unavailable');
    }
    return name === 'getSettings' ? { multimodalEnabled: false } : [];
  }]));
  const runtime = { sendMessage: message => new Promise(resolve => receiver(message, {}, resolve)) };
  const requests = loadModule('src/messaging/requests.ts', { chrome: { runtime } });
  loadModule('src/background/index.ts', {
    chrome: { runtime: { onMessage: { addListener(fn) { receiver = fn; } }, onInstalled: { addListener() {} }, onStartup: { addListener() {} } } },
    require: path => path === '../library/storage' ? storage : path === '../messaging/requests' ? requests : {},
  });
  return { api: loadModule('src/content/library_requests.ts', { chrome: { runtime }, require: path => path === '../messaging/requests' ? requests : {} }), runtime, fail() { failed = true; } };
}

test('read and search distinguish successful empty results from storage failures', async () => {
  const fixture = createMessaging();
  assert.equal((await fixture.api.getSettings()).multimodalEnabled, false);
  assert.equal((await fixture.api.searchPrompts('')).length, 0);
  assert.equal((await fixture.api.searchChains('')).length, 0);
  fixture.fail();
  for (const action of [() => fixture.api.getSettings(), () => fixture.api.searchPrompts(''), () => fixture.api.searchChains('')]) {
    await assert.rejects(action(), /Storage unavailable/);
  }
});

test('usage acknowledges persisted success and rejects a failed write', async () => {
  const fixture = createMessaging();
  await fixture.api.logUsage('prompt', 'chatgpt');
  fixture.fail();
  await assert.rejects(fixture.api.logUsage('prompt', 'chatgpt'), /Storage unavailable/);
});

test('missing responses and rejected transports never look like empty data', async () => {
  const fixture = createMessaging();
  for (const response of [undefined, { type: 'OTHER' }]) {
    fixture.runtime.sendMessage = async () => response;
    await assert.rejects(fixture.api.getSettings(), /response is missing/);
    await assert.rejects(fixture.api.searchPrompts(''), /response is missing/);
    await assert.rejects(fixture.api.searchChains(''), /response is missing/);
  }
  fixture.runtime.sendMessage = async () => { throw new Error('Disconnected'); };
  await assert.rejects(fixture.api.getSettings(), /Disconnected/);
  await assert.rejects(fixture.api.logUsage('prompt', 'chatgpt'), /Disconnected/);
});
