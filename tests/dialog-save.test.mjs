import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import test from 'node:test';
import vm from 'node:vm';

const require = createRequire(resolve('package.json'));
const ts = require('typescript');

function renderDialog(name) {
  const hooks = [];
  let cursor = 0;
  const effects = [];
  const handlers = new Map();
  let resolveSave;
  let saveCalls = 0;
  let closeCalls = 0;
  const savedValues = [];
  const saving = new Promise((resolve) => { resolveSave = resolve; });
  const save = (...values) => { saveCalls++; savedValues.push(values); return saving; };
  const react = {
    useRef(value) { const index = cursor++; hooks[index] ??= { current: value }; return hooks[index]; },
    useState(value) {
      const index = cursor++;
      if (!(index in hooks)) {
        hooks[index] = typeof value === 'function' ? value() : value;
      }
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
    window: { setTimeout: () => 0, clearTimeout() {}, addEventListener: (name, handler) => handlers.set(name, handler), removeEventListener: (name) => handlers.delete(name) },
    require(path) {
      if (path === 'react') {
        return react;
      }
      if (path === 'react/jsx-runtime') {
        return { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) };
      }
      if (path === 'lucide-react') {
        return {};
      }
      if (path === '../library/storage') {
        return { savePrompt: save, updatePrompt: save, saveChain: save };
      }
      if (path === './useToast') {
        return { useToast: () => ({ showToast() {} }) };
      }
      if (path === '../library/attachments') {
        return { createAttachmentDraft(file) { return { id: 'picked-file', name: file.name, size: file.size, mimeType: file.type }; } };
      }
      throw new Error(path);
    },
  });
  let props = { open: true, onClose: () => { closeCalls++; }, initialPrompt: { id: 'p1', title: 'draft', content: 'content', attachments: [] } };
  function render(next = props) {
    props = next;
    cursor = 0;
    const tree = exports.default(props);
    while (effects.length) {
      effects.shift()();
    }
    return tree;
  }
  function find(tree, predicate) {
    if (!tree || typeof tree !== 'object') {
      return null;
    }
    if (predicate(tree)) {
      return tree;
    }
    for (const child of [tree.props?.children].flat(Infinity)) {
      const found = find(child, predicate);
      if (found) {
        return found;
      }
    }
    return null;
  }
  return { render, find, handlers, resolveSave, hooks, savedValues, getProps: () => props, getSaveCalls: () => saveCalls, getCloseCalls: () => closeCalls };
}

test('prompt save blocks duplicate starts and every close path until it settles', async () => {
  const dialog = renderDialog('PromptEditor');
  dialog.render();
  const tree = dialog.render();
  const save = dialog.find(tree, (node) => node.type === 'button' && node.props.onClick?.name === 'handleSave');
  const first = save.props.onClick();
  await save.props.onClick();
  assert.equal(dialog.getSaveCalls(), 1);
  dialog.find(tree, (node) => node.props['aria-label'] === 'Close').props.onClick();
  tree.props.onMouseDown({ target: tree, currentTarget: tree });
  dialog.handlers.get('keydown')({ key: 'Escape', stopPropagation() {} });
  assert.equal(dialog.getCloseCalls(), 0);
  dialog.resolveSave();
  await first;
  assert.equal(dialog.getCloseCalls(), 1);
});

test('editing a saved chain preserves its identity, raw text, and reordered attachments', async () => {
  const dialog = renderDialog('ChainBuilder');
  const attachment = { id: 'saved-file', name: 'saved.txt', size: 1, mimeType: 'text/plain', kind: 'file', createdAt: 1 };
  const initialChain = { id: 'saved-chain', title: 'Saved chain', description: 'Keep this description', createdAt: 12, updatedAt: 20, steps: [
    { content: '  first\n', attachments: [attachment] },
    { content: '\nsecond  ', attachments: [] },
  ] };
  let refreshed = 0;
  dialog.render({ ...dialog.getProps(), initialChain, onSaved: () => { refreshed++; } });
  let tree = dialog.render();
  assert.equal(dialog.find(tree, node => node.props['aria-label'] === 'Chain title').props.value, 'Saved chain');
  dialog.find(tree, node => node.props['aria-label'] === 'Move down').props.onClick();
  tree = dialog.render();
  const saving = dialog.find(tree, node => node.props.onClick?.name === 'handleSaveChain').props.onClick();
  const saved = dialog.savedValues[0][0];
  assert.equal(saved.id, 'saved-chain');
  assert.equal(saved.createdAt, 12);
  assert.equal(saved.description, 'Keep this description');
  assert.equal(saved.steps[0].content, '\nsecond  ');
  assert.equal(saved.steps[1].content, '  first\n');
  assert.equal(saved.steps[1].attachments[0].id, 'saved-file');
  assert.equal(dialog.savedValues[0][1].size, 0);
  assert.equal(initialChain.steps[0].content, '  first\n');
  dialog.resolveSave();
  await saving;
  assert.equal(refreshed, 1);
  assert.equal(dialog.getCloseCalls(), 1);
});

test('cancelling a saved chain edit does not persist a change', () => {
  const dialog = renderDialog('ChainBuilder');
  const initialChain = { id: 'saved-chain', title: 'Saved', createdAt: 12, updatedAt: 20, steps: [{ content: 'step', attachments: [] }] };
  dialog.render({ ...dialog.getProps(), initialChain });
  const tree = dialog.render();
  dialog.find(tree, node => node.props['aria-label'] === 'Chain title').props.onChange({ target: { value: 'Changed' } });
  dialog.find(tree, node => node.props['aria-label'] === 'Close').props.onClick();
  assert.equal(dialog.getSaveCalls(), 0);
  assert.equal(initialChain.title, 'Saved');
});

test('an old chain save cannot close a replacement chain draft', async () => {
  const dialog = renderDialog('ChainBuilder');
  const initialChain = { id: 'first', title: 'First', createdAt: 12, updatedAt: 20, steps: [{ content: 'step', attachments: [] }] };
  dialog.render({ ...dialog.getProps(), initialChain });
  const saving = dialog.find(dialog.render(), node => node.props.onClick?.name === 'handleSaveChain').props.onClick();
  dialog.render({ ...dialog.getProps(), initialChain: { ...initialChain, id: 'second', title: 'Second' } });
  dialog.resolveSave();
  await saving;
  assert.equal(dialog.getCloseCalls(), 0);
  assert.equal(dialog.find(dialog.render(), node => node.props['aria-label'] === 'Chain title').props.value, 'Second');
});

test('an old prompt save cannot clear or close a replacement draft', async () => {
  const dialog = renderDialog('PromptEditor');
  dialog.render();
  const tree = dialog.render();
  const saving = dialog.find(tree, (node) => node.props.onClick?.name === 'handleSave').props.onClick();
  dialog.render({ ...dialog.getProps(), initialPrompt: { id: 'p2', title: 'second', content: 'second', attachments: [] } });
  const pending = dialog.hooks.find((hook) => hook?.current instanceof Map).current;
  pending.set('second-file', {});
  dialog.resolveSave();
  await saving;
  assert.equal(pending.has('second-file'), true);
  assert.equal(dialog.getCloseCalls(), 0);
});

test('chain save blocks duplicate starts and close paths until its transaction settles', async () => {
  const dialog = renderDialog('ChainBuilder');
  dialog.render();
  let tree = dialog.render();
  for (const placeholder of ['Step 1 prompt', 'Step 2 prompt', 'Chain title']) {
    dialog.find(tree, (node) => node.props.placeholder === placeholder).props.onChange({ target: { value: placeholder } });
  }
  tree = dialog.render();
  const save = dialog.find(tree, (node) => node.props.onClick?.name === 'handleSaveChain');
  const first = save.props.onClick();
  await save.props.onClick();
  assert.equal(dialog.getSaveCalls(), 1);
  dialog.find(tree, (node) => node.props['aria-label'] === 'Close').props.onClick();
  tree.props.onMouseDown({ target: tree, currentTarget: tree });
  dialog.handlers.get('keydown')({ key: 'Escape', stopPropagation() {} });
  assert.equal(dialog.getCloseCalls(), 0);
  dialog.resolveSave();
  await first;
  assert.equal(dialog.getCloseCalls(), 1);
});

test('pending prompt saves disable the form and reject draft edits and late file selections', async () => {
  const dialog = renderDialog('PromptEditor');
  dialog.render();
  let tree = dialog.render();
  const title = dialog.find(tree, (node) => node.type === 'input' && node.props.type !== 'file');
  const content = dialog.find(tree, (node) => node.type === 'textarea');
  const picker = dialog.find(tree, (node) => node.props.type === 'file');
  dialog.find(tree, (node) => node.type === 'button' && node.props.className?.startsWith('compact-button')).props.onClick();
  const saving = dialog.find(tree, (node) => node.props.onClick?.name === 'handleSave').props.onClick();
  title.props.onChange({ target: { value: 'changed' } });
  content.props.onChange({ target: { value: 'changed' } });
  picker.props.onChange({ target: { files: [new File(['late'], 'late.txt')] } });
  tree = dialog.render();
  assert.equal(dialog.find(tree, (node) => node.type === 'fieldset').props.disabled, true);
  assert.equal(dialog.find(tree, (node) => node.type === 'input' && node.props.type !== 'file').props.value, 'draft');
  assert.equal(dialog.find(tree, (node) => node.type === 'textarea').props.value, 'content');
  assert.equal(dialog.hooks.find((hook) => hook?.current instanceof Map).current.size, 0);
  dialog.resolveSave();
  await saving;
});

test('a file picker opened for an old prompt cannot attach to its replacement', () => {
  const dialog = renderDialog('PromptEditor');
  dialog.render();
  const tree = dialog.render();
  dialog.find(tree, (node) => node.type === 'button' && node.props.className?.startsWith('compact-button')).props.onClick();
  const picker = dialog.find(tree, (node) => node.props.type === 'file');
  dialog.render({ ...dialog.getProps(), initialPrompt: { id: 'p2', title: 'new', content: 'new', attachments: [] } });
  picker.props.onChange({ target: { files: [new File(['old'], 'old.txt')] } });
  assert.equal(dialog.hooks.find((hook) => hook?.current instanceof Map).current.size, 0);
});

test('pending chain saves reject title, step text, and step additions', async () => {
  const dialog = renderDialog('ChainBuilder');
  dialog.render();
  let tree = dialog.render();
  const step = dialog.find(tree, (node) => node.props.placeholder === 'Step 1 prompt');
  for (const placeholder of ['Step 1 prompt', 'Step 2 prompt', 'Chain title']) {
    dialog.find(tree, (node) => node.props.placeholder === placeholder).props.onChange({ target: { value: placeholder } });
  }
  tree = dialog.render();
  const saving = dialog.find(tree, (node) => node.props.onClick?.name === 'handleSaveChain').props.onClick();
  step.props.onChange({ target: { value: 'late change' } });
  dialog.find(tree, (node) => node.props.placeholder === 'Chain title').props.onChange({ target: { value: 'late title' } });
  dialog.find(tree, (node) => node.props.onClick?.name === 'addStep').props.onClick();
  tree = dialog.render();
  assert.equal(dialog.find(tree, (node) => node.type === 'fieldset').props.disabled, true);
  assert.equal(dialog.find(tree, (node) => node.props.placeholder === 'Chain title').props.value, 'Chain title');
  const items = dialog.hooks.find((hook) => Array.isArray(hook) && hook[0]?.content);
  assert.equal(items.length, 2);
  assert.equal(items[0].content, 'Step 1 prompt');
  dialog.resolveSave();
  await saving;
});

for (const name of ['PromptEditor', 'ChainBuilder']) {
  test(`${name} traps Tab when all controls inherit disabled from the fieldset`, () => {
    const dialog = renderDialog(name);
    dialog.render();
    const tree = dialog.render();
    const dialogNode = dialog.find(tree, (node) => node.props.role === 'dialog');
    dialogNode.props.ref.current = {
      querySelectorAll: () => [{ matches: (selector) => selector === ':disabled' }],
    };
    let prevented = false;
    dialog.handlers.get('keydown')({ key: 'Tab', preventDefault() { prevented = true; } });
    assert.equal(prevented, true);
  });
}

for (const editing of [true, false]) {
  test(`file-only prompt ${editing ? 'editing' : 'creation'} saves attachments without content`, async () => {
    const dialog = renderDialog('PromptEditor');
    dialog.render({ ...dialog.getProps(), initialPrompt: editing ? { id: 'p1', title: 'Files', content: '', attachments: [{ id: 'file', name: 'notes.txt' }] } : undefined });
    let tree = dialog.render();
    if (!editing) {
      dialog.find(tree, node => node.props.id === 'prompt-title').props.onChange({ target: { value: 'Files' } });
      dialog.find(tree, node => node.type === 'button' && node.props.className?.startsWith('compact-button')).props.onClick();
      await dialog.find(tree, node => node.props.type === 'file').props.onChange({ target: { files: [{ name: 'notes.txt', size: 1, type: 'text/plain' }] } });
      tree = dialog.render();
    }
    const pending = dialog.find(tree, node => node.type === 'button' && node.props.onClick?.name === 'handleSave').props.onClick();
    assert.equal(dialog.getSaveCalls(), 1);
    const saved = dialog.savedValues[0][editing ? 1 : 0];
    assert.equal(saved.content, '');
    assert.equal(saved.attachments.length, 1);
    dialog.resolveSave();
    await pending;
  });
}

test('removing the last attachment keeps an empty prompt from saving', async () => {
  const dialog = renderDialog('PromptEditor');
  dialog.render({ ...dialog.getProps(), initialPrompt: { id: 'p1', title: 'Files', content: '  ', attachments: [{ id: 'file', name: 'notes.txt' }] } });
  let tree = dialog.render();
  dialog.find(tree, node => node.props['aria-label'] === 'Remove notes.txt').props.onClick();
  tree = dialog.render();
  await dialog.find(tree, node => node.type === 'button' && node.props.onClick?.name === 'handleSave').props.onClick();
  assert.equal(dialog.getSaveCalls(), 0);
  tree = dialog.render();
  assert.equal(dialog.find(tree, node => node.props.role === 'alert').props.children, 'Add prompt content or at least one attachment.');
});
