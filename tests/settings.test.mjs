import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import test from 'node:test';
import vm from 'node:vm';

const require = createRequire(resolve('package.json'));
const ts = require('typescript');

function compileSource(path) {
  return ts.transpileModule(readFileSync(resolve(path), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
}

function createSettings() {
  const hooks = [];
  const effects = [];
  const loads = [];
  const messages = [];
  const snapshots = [];
  let cursor = 0;
  let backCount = 0;
  let receiver;
  let release;
  let failWrite = false;
  let transportFailure = null;
  let persisted = null;
  let queue = Promise.resolve();
  const blocked = new Promise((resolve) => { release = resolve; });
  const saveSettings = (settings) => {
    const snapshot = structuredClone(settings);
    snapshots.push(snapshot);
    const result = queue.then(async () => {
      await blocked;
      if (failWrite) { failWrite = false; throw new Error('Write failed'); }
      persisted = snapshot;
    });
    queue = result.catch(() => {});
    return result;
  };
  const popupChrome = { runtime: { sendMessage(message) {
    if (transportFailure === 'throw') throw new Error('Context invalidated');
    if (transportFailure === 'reject') return Promise.reject(new Error('No receiver'));
    messages.push(structuredClone(message));
    return new Promise((resolve) => {
      assert.equal(receiver(structuredClone(message), {}, resolve), true);
    });
  } } };
  const requests = {};
  vm.runInNewContext(compileSource('src/messaging/transport.ts'), { exports: requests, Error, chrome: popupChrome });
  vm.runInNewContext(compileSource('src/background/index.ts'), {
    exports: {},
    chrome: { runtime: { onMessage: { addListener(fn) { receiver = fn; } }, onInstalled: { addListener() {} }, onStartup: { addListener() {} } } },
    require(path) {
      if (path === '../library/storage') return { saveSettings };
      if (path === '../messaging/transport') return requests;
      return {};
    },
  });
  const react = {
    useRef(value) { const index = cursor++; hooks[index] ??= { current: value }; return hooks[index]; },
    useState(value) {
      const index = cursor++;
      if (!(index in hooks)) hooks[index] = typeof value === 'function' ? value() : value;
      return [hooks[index], (next) => { hooks[index] = typeof next === 'function' ? next(hooks[index]) : next; }];
    },
    useCallback(callback, deps) {
      const index = cursor++;
      if (!hooks[index] || deps.some((dep, i) => dep !== hooks[index].deps[i])) hooks[index] = { deps, callback };
      return hooks[index].callback;
    },
    useEffect(callback, deps) {
      const index = cursor++;
      if (!hooks[index] || deps.some((dep, i) => dep !== hooks[index].deps[i])) {
        effects.push(() => { hooks[index]?.cleanup?.(); hooks[index] = { deps, cleanup: callback() }; });
      }
    },
  };
  const exports = {};
  vm.runInNewContext(compileSource('src/popup/Settings.tsx'), {
    exports,
    navigator: { platform: 'Mac' },
    chrome: popupChrome,
    require(path) {
      if (path === 'react') return react;
      if (path === 'react/jsx-runtime') return { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) };
      if (path === '../library/storage') return { getSettings: () => new Promise((resolve, reject) => loads.push({ resolve, reject })) };
      if (path === '../components/useToast') return { useToast: () => ({ showToast() {} }) };
      if (path === '../messaging/transport') return requests;
      return {};
    },
  });
  function render() {
    cursor = 0;
    const tree = exports.default({ onBack: () => { backCount++; } });
    while (effects.length) effects.shift()();
    return tree;
  }
  function find(tree, predicate) {
    if (!tree || typeof tree !== 'object') return null;
    if (predicate(tree)) return tree;
    for (const child of [tree.props?.children].flat(Infinity)) {
      const found = find(child, predicate);
      if (found) return found;
    }
    return null;
  }
  function unmount() {
    for (const hook of hooks) hook?.cleanup?.();
  }
  async function settle() { await new Promise((resolve) => setImmediate(resolve)); }
  return { render, find, loads, messages, snapshots, release, unmount, settle, failNextWrite() { failWrite = true; }, failTransport(mode) { transportFailure = mode; }, getBackCount: () => backCount, getPersisted: () => persisted };
}

test('prehydration Save and change callbacks cannot overwrite stored settings', async () => {
  const app = createSettings();
  const tree = app.render();
  assert.equal(app.find(tree, (node) => node.type === 'fieldset').props.disabled, true);
  await app.find(tree, (node) => node.props.onClick?.name === 'saveAll').props.onClick();
  app.find(tree, (node) => node.type === 'input' && node.props.type === 'checkbox').props.onChange({ target: { checked: false } });
  assert.equal(app.messages.length, 0);
  app.loads[0].resolve({ multimodalEnabled: true, insertionMode: 'append' });
  await app.settle();
  assert.equal(app.find(app.render(), (node) => node.type === 'fieldset').props.disabled, false);
  assert.equal(app.messages.length, 0);
});

test('rapid changes dispatch ordered background saves and preserve unknown settings fields', async () => {
  const app = createSettings();
  app.render();
  app.loads[0].resolve({ multimodalEnabled: true, futureOption: { value: 42 }, shortcuts: { futureShortcut: 'key' } });
  await app.settle();
  const tree = app.render();
  const toggle = app.find(tree, (node) => node.type === 'input' && node.props.type === 'checkbox');
  toggle.props.onChange({ target: { checked: false } });
  toggle.props.onChange({ target: { checked: true } });
  assert.equal(app.messages.length, 2);
  assert.equal(app.snapshots.length, 2);
  app.release();
  await app.settle();
  assert.equal(app.getPersisted().multimodalEnabled, true);
  assert.equal(app.getPersisted().futureOption.value, 42);
  assert.equal(app.getPersisted().shortcuts.futureShortcut, 'key');
});

test('Back waits for the latest background save to finish', async () => {
  const app = createSettings();
  app.render();
  app.loads[0].resolve({ multimodalEnabled: true });
  await app.settle();
  const tree = app.render();
  app.find(tree, (node) => node.type === 'input' && node.props.type === 'checkbox').props.onChange({ target: { checked: false } });
  const back = app.find(tree, (node) => node.props['aria-label'] === 'Back').props.onClick();
  assert.equal(app.getBackCount(), 0);
  app.release();
  await back;
  assert.equal(app.getBackCount(), 1);
  assert.equal(app.getPersisted().multimodalEnabled, false);
});

test('popup unmount cannot discard a save already dispatched to the background', async () => {
  const app = createSettings();
  app.render();
  app.loads[0].resolve({ multimodalEnabled: true });
  await app.settle();
  const tree = app.render();
  app.find(tree, (node) => node.type === 'input' && node.props.type === 'checkbox').props.onChange({ target: { checked: false } });
  assert.equal(app.snapshots.length, 1);
  app.unmount();
  app.release();
  await app.settle();
  assert.equal(app.getPersisted().multimodalEnabled, false);
});

test('load failure leaves controls disabled and retry can hydrate without saving defaults', async () => {
  const app = createSettings();
  app.render();
  app.loads[0].reject(new Error('Read failed'));
  await app.settle();
  let tree = app.render();
  assert.equal(app.find(tree, (node) => node.type === 'fieldset').props.disabled, true);
  assert.ok(app.find(tree, (node) => node.props.role === 'alert'));
  const retry = app.find(tree, (node) => node.props.children === 'Retry loading').props.onClick();
  app.loads[1].resolve({ insertionMode: 'append' });
  await retry;
  tree = app.render();
  assert.equal(app.find(tree, (node) => node.type === 'fieldset').props.disabled, false);
  assert.equal(app.messages.length, 0);
});

test('failed background writes block Back and explicit Save retries the latest snapshot', async () => {
  const app = createSettings();
  app.render();
  app.loads[0].resolve({ multimodalEnabled: true });
  await app.settle();
  let tree = app.render();
  app.failNextWrite();
  app.find(tree, (node) => node.type === 'input' && node.props.type === 'checkbox').props.onChange({ target: { checked: false } });
  app.release();
  await app.settle();
  tree = app.render();
  assert.equal(app.find(tree, (node) => node.props.role === 'status').props.children, 'Save failed');
  await app.find(tree, (node) => node.props['aria-label'] === 'Back').props.onClick();
  assert.equal(app.getBackCount(), 0);
  await app.find(tree, (node) => node.props.onClick?.name === 'saveAll').props.onClick();
  await app.find(app.render(), (node) => node.props['aria-label'] === 'Back').props.onClick();
  assert.equal(app.getBackCount(), 1);
  assert.equal(app.getPersisted().multimodalEnabled, false);
});

for (const mode of ['throw', 'reject']) {
  test(`runtime ${mode} errors become a retryable Save failed state`, async () => {
    const app = createSettings();
    app.render();
    app.loads[0].resolve({ multimodalEnabled: true });
    await app.settle();
    app.failTransport(mode);
    const tree = app.render();
    await app.find(tree, (node) => node.props.onClick?.name === 'saveAll').props.onClick();
    assert.equal(app.find(app.render(), (node) => node.props.role === 'status').props.children, 'Save failed');
  });
}

test('Back continues waiting when another change is dispatched while the first save is pending', async () => {
  const app = createSettings();
  app.render();
  app.loads[0].resolve({ multimodalEnabled: true });
  await app.settle();
  const tree = app.render();
  const toggle = app.find(tree, (node) => node.type === 'input' && node.props.type === 'checkbox');
  toggle.props.onChange({ target: { checked: false } });
  const back = app.find(tree, (node) => node.props['aria-label'] === 'Back').props.onClick();
  toggle.props.onChange({ target: { checked: true } });
  assert.equal(app.getBackCount(), 0);
  app.release();
  await back;
  assert.equal(app.getBackCount(), 1);
  assert.equal(app.getPersisted().multimodalEnabled, true);
});
