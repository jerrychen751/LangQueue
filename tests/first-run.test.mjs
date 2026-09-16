import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import * as requests from '../src/messaging/transport.ts';

const require = createRequire(resolve('package.json'));
const ts = require('typescript');

function installBackground(create) {
  let installed;
  vm.runInNewContext(ts.transpileModule(readFileSync(resolve('src/background/index.ts'), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, {
    exports: {},
    chrome: {
      runtime: { onMessage: { addListener() {} }, onInstalled: { addListener(fn) { installed = fn; } }, getURL: (path) => `chrome-extension://id/${path}` },
      tabs: { create },
    },
    require: (path) => path === '../messaging/transport' ? requests : {},
  });
  return installed;
}

test('a fresh install opens the onboarding page and updates do not', () => {
  const created = [];
  const installed = installBackground(async (properties) => { created.push(properties.url); return {}; });
  installed({ reason: 'update' });
  installed({ reason: 'chrome_update' });
  assert.deepEqual(created, []);
  installed({ reason: 'install' });
  assert.deepEqual(created, ['chrome-extension://id/onboarding.html']);
});

test('a tab that cannot open on install is not an unhandled rejection', async () => {
  const installed = installBackground(async () => { throw new Error('No browser window'); });
  const rejections = [];
  const record = (reason) => rejections.push(reason);
  process.on('unhandledRejection', record);
  try {
    installed({ reason: 'install' });
    await new Promise((resolve) => setImmediate(resolve));
  } finally {
    process.off('unhandledRejection', record);
  }
  assert.deepEqual(rejections, []);
});
