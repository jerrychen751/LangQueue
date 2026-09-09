import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import test from 'node:test';
import vm from 'node:vm';

const require = createRequire(resolve('package.json'));
const ts = require('typescript');

function createModal(name) {
  const hooks = [];
  let cursor = 0;
  const effects = [];
  const handlers = new Map();
  let resolveSave;
  let saveCalls = 0;
  let closeCalls = 0;
  const saving = new Promise((resolve) => { resolveSave = resolve; });
  const save = () => { saveCalls++; return saving; };
  const react = {
    useRef(value) { const index = cursor++; hooks[index] ??= { current: value }; return hooks[index]; },
    useState(value) {
      const index = cursor++;
      if (!(index in hooks)) hooks[index] = typeof value === 'function' ? value() : value;
      return [hooks[index], (next) => { hooks[index] = typeof next === 'function' ? next(hooks[index]) : next; }];
    },
    useEffect(callback, deps) {
      const index = cursor++;
      if (!hooks[index] || deps.some((dep, i) => dep !== hooks[index].deps[i])) {
        effects.push(() => { hooks[index]?.cleanup?.(); hooks[index] = { deps, cleanup: callback() }; });
      }
    },
    useCallback(callback) { return callback; },
  };
  const exports = {};
  const source = ts.transpileModule(readFileSync(resolve(`src/components/${name}.tsx`), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  vm.runInNewContext(source, {
    exports, Map, setTimeout: () => 0,
    navigator: { platform: 'Mac' }, document: { activeElement: null },
    window: { addEventListener: (name, handler) => handlers.set(name, handler), removeEventListener: (name) => handlers.delete(name) },
    require(path) {
      if (path === 'react') return react;
      if (path === 'react/jsx-runtime') return { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) };
      if (path === 'lucide-react') return {};
      if (path === '../utils/storage') return { savePrompt: save, updatePrompt: save, saveChain: save };
      if (path === './useToast') return { useToast: () => ({ showToast() {} }) };
      if (path === '../utils/attachments') return { createAttachmentDraft(file) { return { id: 'picked-file', name: file.name, size: file.size, mimeType: file.type }; } };
      throw new Error(path);
    },
  });
  let props = { open: true, onClose: () => { closeCalls++; }, initialPrompt: { id: 'p1', title: 'draft', content: 'content', attachments: [] } };
  function render(next = props) {
    props = next;
    cursor = 0;
    const tree = exports.default(props);
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
  return { render, find, handlers, resolveSave, hooks, getProps: () => props, getSaveCalls: () => saveCalls, getCloseCalls: () => closeCalls };
}

test('prompt save blocks duplicate starts and every close path until it settles', async () => {
  const modal = createModal('PromptModal');
  modal.render();
  const tree = modal.render();
  const save = modal.find(tree, (node) => node.type === 'button' && node.props.onClick?.name === 'handleSave');
  const first = save.props.onClick();
  await save.props.onClick();
  assert.equal(modal.getSaveCalls(), 1);
  modal.find(tree, (node) => node.props['aria-label'] === 'Close').props.onClick();
  tree.props.onMouseDown({ target: tree, currentTarget: tree });
  modal.handlers.get('keydown')({ key: 'Escape', stopPropagation() {} });
  assert.equal(modal.getCloseCalls(), 0);
  modal.resolveSave();
  await first;
  assert.equal(modal.getCloseCalls(), 1);
});

test('an old prompt save cannot clear or close a replacement draft', async () => {
  const modal = createModal('PromptModal');
  modal.render();
  const tree = modal.render();
  const saving = modal.find(tree, (node) => node.props.onClick?.name === 'handleSave').props.onClick();
  modal.render({ ...modal.getProps(), initialPrompt: { id: 'p2', title: 'second', content: 'second', attachments: [] } });
  const pending = modal.hooks.find((hook) => hook?.current instanceof Map).current;
  pending.set('second-file', {});
  modal.resolveSave();
  await saving;
  assert.equal(pending.has('second-file'), true);
  assert.equal(modal.getCloseCalls(), 0);
});

test('chain save blocks duplicate starts and close paths until its transaction settles', async () => {
  const modal = createModal('ChainBuilder');
  modal.render();
  let tree = modal.render();
  for (const placeholder of ['Step 1 prompt', 'Step 2 prompt', 'Chain title']) {
    modal.find(tree, (node) => node.props.placeholder === placeholder).props.onChange({ target: { value: placeholder } });
  }
  tree = modal.render();
  const save = modal.find(tree, (node) => node.props.onClick?.name === 'handleSaveChain');
  const first = save.props.onClick();
  await save.props.onClick();
  assert.equal(modal.getSaveCalls(), 1);
  modal.find(tree, (node) => node.props['aria-label'] === 'Close').props.onClick();
  tree.props.onMouseDown({ target: tree, currentTarget: tree });
  modal.handlers.get('keydown')({ key: 'Escape', stopPropagation() {} });
  assert.equal(modal.getCloseCalls(), 0);
  modal.resolveSave();
  await first;
  assert.equal(modal.getCloseCalls(), 1);
});

test('pending prompt saves disable the form and reject draft edits and late file selections', async () => {
  const modal = createModal('PromptModal');
  modal.render();
  let tree = modal.render();
  const title = modal.find(tree, (node) => node.type === 'input' && node.props.type !== 'file');
  const content = modal.find(tree, (node) => node.type === 'textarea');
  const picker = modal.find(tree, (node) => node.props.type === 'file');
  modal.find(tree, (node) => node.type === 'button' && node.props.className?.startsWith('compact-button')).props.onClick();
  const saving = modal.find(tree, (node) => node.props.onClick?.name === 'handleSave').props.onClick();
  title.props.onChange({ target: { value: 'changed' } });
  content.props.onChange({ target: { value: 'changed' } });
  picker.props.onChange({ target: { files: [new File(['late'], 'late.txt')] } });
  tree = modal.render();
  assert.equal(modal.find(tree, (node) => node.type === 'fieldset').props.disabled, true);
  assert.equal(modal.find(tree, (node) => node.type === 'input' && node.props.type !== 'file').props.value, 'draft');
  assert.equal(modal.find(tree, (node) => node.type === 'textarea').props.value, 'content');
  assert.equal(modal.hooks.find((hook) => hook?.current instanceof Map).current.size, 0);
  modal.resolveSave();
  await saving;
});

test('a file picker opened for an old prompt cannot attach to its replacement', () => {
  const modal = createModal('PromptModal');
  modal.render();
  const tree = modal.render();
  modal.find(tree, (node) => node.type === 'button' && node.props.className?.startsWith('compact-button')).props.onClick();
  const picker = modal.find(tree, (node) => node.props.type === 'file');
  modal.render({ ...modal.getProps(), initialPrompt: { id: 'p2', title: 'new', content: 'new', attachments: [] } });
  picker.props.onChange({ target: { files: [new File(['old'], 'old.txt')] } });
  assert.equal(modal.hooks.find((hook) => hook?.current instanceof Map).current.size, 0);
});

test('pending chain saves reject title, step text, and step additions', async () => {
  const modal = createModal('ChainBuilder');
  modal.render();
  let tree = modal.render();
  const step = modal.find(tree, (node) => node.props.placeholder === 'Step 1 prompt');
  for (const placeholder of ['Step 1 prompt', 'Step 2 prompt', 'Chain title']) {
    modal.find(tree, (node) => node.props.placeholder === placeholder).props.onChange({ target: { value: placeholder } });
  }
  tree = modal.render();
  const saving = modal.find(tree, (node) => node.props.onClick?.name === 'handleSaveChain').props.onClick();
  step.props.onChange({ target: { value: 'late change' } });
  modal.find(tree, (node) => node.props.placeholder === 'Chain title').props.onChange({ target: { value: 'late title' } });
  modal.find(tree, (node) => node.props.onClick?.name === 'addStep').props.onClick();
  tree = modal.render();
  assert.equal(modal.find(tree, (node) => node.type === 'fieldset').props.disabled, true);
  assert.equal(modal.find(tree, (node) => node.props.placeholder === 'Chain title').props.value, 'Chain title');
  const items = modal.hooks.find((hook) => Array.isArray(hook) && hook[0]?.content);
  assert.equal(items.length, 2);
  assert.equal(items[0].content, 'Step 1 prompt');
  modal.resolveSave();
  await saving;
});

for (const name of ['PromptModal', 'ChainBuilder']) {
  test(`${name} traps Tab when all controls inherit disabled from the fieldset`, () => {
    const modal = createModal(name);
    modal.render();
    const tree = modal.render();
    const dialog = modal.find(tree, (node) => node.props.role === 'dialog');
    dialog.props.ref.current = {
      querySelectorAll: () => [{ matches: (selector) => selector === ':disabled' }],
    };
    let prevented = false;
    modal.handlers.get('keydown')({ key: 'Tab', preventDefault() { prevented = true; } });
    assert.equal(prevented, true);
  });
}
