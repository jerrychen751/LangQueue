import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import test from 'node:test';
import vm from 'node:vm';

const require = createRequire(resolve('package.json'));
const ts = require('typescript');

function createPopup(name, overrides = {}, library = {}) {
  const hooks = [];
  let cursor = 0;
  const toasts = [];
  let closes = 0;
  let copies = 0;
  let uses = 0;
  const prompt = { id: 'p1', title: 'Prompt', content: 'Contents', attachments: [] };
  const react = {
    useState(initial) {
      const index = cursor++;
      if (!(index in hooks)) hooks[index] = name === 'App' && index === 0 ? library.prompts ?? [prompt] : name === 'App' && index === 3 ? false : name === 'App' && index === 6 ? library.compatible ?? initial : name === 'App' && index === 12 ? library.chains ?? initial : initial;
      return [hooks[index], value => { hooks[index] = typeof value === 'function' ? value(hooks[index]) : value; }];
    },
    useRef(initial) { const index = cursor++; hooks[index] ??= { current: initial }; return hooks[index]; },
    useEffect() {},
    useCallback(callback) { return callback; },
    useMemo(callback) { return callback(); },
  };
  const exports = {};
  const source = ts.transpileModule(readFileSync(resolve(`src/popup/${name}.tsx`), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  vm.runInNewContext(source, {
    exports, console, Date, Error,
    window: { close() { closes++; } },
    navigator: { clipboard: { async writeText() { copies++; } } },
    require(path) {
      if (path === 'react') return react;
      if (path === 'react/jsx-runtime') return { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) };
      if (path === 'lucide-react') return {};
      if (path === '../components/useToast') return { useToast: () => ({ showToast: toast => toasts.push(toast) }) };
      if (path === '../utils/storage') return {
        getAllPrompts: async () => [prompt], getAllChains: async () => [], getUsageStats: async () => ({}),
        logUsage: async () => { uses++; }, deletePrompt: async () => {}, ...overrides,
      };
      if (path === '../utils/messaging') return { sendPromptToTab: async () => {}, ...overrides };
      if (path === './PromptCard') return { PromptCard: 'PromptCard' };
      return { default: path };
    },
  });
  function render(props = {}) {
    cursor = 0;
    return (exports.default || exports.PromptCard)({ index: 0, prompt, ...props });
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
  return { render, find, prompt, toasts, hooks, getCloses: () => closes, getCopies: () => copies, getUses: () => uses };
}

test('failed insertion keeps the popup open without copying or logging usage', async () => {
  const popup = createPopup('App', { sendPromptToTab: async () => { throw new Error('Composer unavailable'); } });
  const card = popup.find(popup.render(), node => node.type === 'PromptCard');
  await card.props.onInsert(popup.prompt);
  assert.equal(popup.getCopies(), 0);
  assert.equal(popup.getCloses(), 0);
  assert.equal(popup.getUses(), 0);
  assert.equal(popup.toasts.length, 1);
  assert.equal(popup.toasts[0].variant, 'error');
  assert.match(popup.toasts[0].message, /Check the chat composer/);
});

test('a chain-only library keeps its edit and run actions visible', () => {
  const chain = { id: 'c1', title: 'Only chain', steps: [{ content: 'step', attachments: [] }] };
  const popup = createPopup('App', {}, { prompts: [], chains: [chain], compatible: true });
  const tree = popup.render();
  assert.ok(popup.find(tree, node => node.props['aria-label'] === 'Run chain Only chain'));
  popup.find(tree, node => node.props['aria-label'] === 'Edit chain Only chain').props.onClick();
  const builder = popup.find(popup.render(), node => node.type === '../components/ChainBuilder');
  assert.equal(builder.props.initialChain.id, 'c1');
  assert.equal(builder.props.open, true);
});

test('chain run reports acceptance only after the request resolves and blocks duplicate starts', async () => {
  const chain = { id: 'c1', title: 'Saved', steps: [{ content: 'step', attachments: [] }] };
  let finishStart;
  let starts = 0;
  const pending = new Promise(resolve => { finishStart = resolve; });
  const popup = createPopup('App', { runChainOnTab: () => { starts++; return pending; } }, { chains: [chain], compatible: true });
  const run = popup.find(popup.render(), node => node.props['aria-label'] === 'Run chain Saved');
  const starting = run.props.onClick();
  await run.props.onClick();
  assert.equal(starts, 1);
  assert.equal(popup.toasts.length, 0);
  finishStart();
  await starting;
  assert.match(popup.toasts[0].message, /Chain started/);
  assert.equal(popup.getCloses(), 0);
});

test('chain run rejection stays actionable and never reports completion', async () => {
  const chain = { id: 'c1', title: 'Saved', steps: [{ content: 'step', attachments: [] }] };
  const popup = createPopup('App', { runChainOnTab: async () => { throw new Error('Start a conversation first'); } }, { chains: [chain], compatible: true });
  await popup.find(popup.render(), node => node.props['aria-label'] === 'Run chain Saved').props.onClick();
  assert.equal(popup.toasts.length, 1);
  assert.equal(popup.toasts[0].variant, 'error');
  assert.match(popup.toasts[0].message, /Start a conversation first/);
  assert.equal(popup.getCloses(), 0);
});

test('successful insertion closes only after recording usage', async () => {
  const popup = createPopup('App');
  const card = popup.find(popup.render(), node => node.type === 'PromptCard');
  await card.props.onInsert(popup.prompt);
  assert.equal(popup.getUses(), 1);
  assert.equal(popup.getCloses(), 1);
});

test('duplicate insertion clicks share one pending operation', async () => {
  let finishInsert;
  let inserts = 0;
  const pending = new Promise(resolve => { finishInsert = resolve; });
  const popup = createPopup('App', { sendPromptToTab: () => { inserts++; return pending; } });
  const card = popup.find(popup.render(), node => node.type === 'PromptCard');
  const inserting = card.props.onInsert(popup.prompt);
  await card.props.onInsert(popup.prompt);
  assert.equal(inserts, 1);
  finishInsert();
  await inserting;
  assert.equal(popup.getUses(), 1);
});

test('usage failure after insertion reports the completed insertion honestly', async () => {
  const popup = createPopup('App', { logUsage: async () => { throw new Error('Storage failed'); } });
  await popup.find(popup.render(), node => node.type === 'PromptCard').props.onInsert(popup.prompt);
  assert.equal(popup.getCloses(), 0);
  assert.match(popup.toasts.at(-1).message, /Prompt inserted, but usage counts/);
});

test('prompt confirmation waits for deletion and ignores duplicate attempts', async () => {
  let finishDelete;
  let deletes = 0;
  const pending = new Promise(resolve => { finishDelete = resolve; });
  const props = { onDelete: () => { deletes++; return pending; } };
  const popup = createPopup('PromptCard');
  popup.find(popup.render(props), node => node.props.title === 'Delete prompt').props.onClick();
  const modal = popup.find(popup.render(props), node => node.props.title === 'Delete this prompt?');
  const deleting = modal.props.onConfirm();
  await modal.props.onConfirm();
  modal.props.onCancel();
  assert.equal(deletes, 1);
  assert.equal(popup.toasts.length, 0);
  assert.equal(popup.find(popup.render(props), node => node.props.title === 'Delete this prompt?').props.open, true);
  finishDelete();
  await deleting;
  assert.equal(popup.find(popup.render(props), node => node.props.title === 'Delete this prompt?').props.open, false);
  assert.equal(popup.toasts[0].variant, 'success');
});

test('failed deletion keeps confirmation open and allows retry', async () => {
  let deletes = 0;
  const props = { onDelete: async () => { if (++deletes === 1) throw new Error('Could not write storage'); } };
  const popup = createPopup('PromptCard');
  popup.find(popup.render(props), node => node.props.title === 'Delete prompt').props.onClick();
  await popup.find(popup.render(props), node => node.props.title === 'Delete this prompt?').props.onConfirm();
  const modal = popup.find(popup.render(props), node => node.props.title === 'Delete this prompt?');
  assert.equal(modal.props.open, true);
  assert.equal(popup.toasts[0].variant, 'error');
  await modal.props.onConfirm();
  assert.equal(deletes, 2);
  assert.equal(popup.toasts[1].variant, 'success');
});

test('chain deletion waits for storage, prevents duplicate work, and reports failure', async () => {
  let failDelete;
  let deletes = 0;
  const pending = new Promise((resolve, reject) => { failDelete = reject; });
  const popup = createPopup('App', { deleteChain: () => { deletes++; return pending; } });
  popup.render();
  popup.hooks[popup.hooks.indexOf(null)] = { id: 'c1', title: 'Chain' };
  const modal = popup.find(popup.render(), node => node.props.title === 'Delete chain?');
  const deleting = modal.props.onConfirm();
  await modal.props.onConfirm();
  modal.props.onCancel();
  assert.equal(deletes, 1);
  assert.equal(popup.find(popup.render(), node => node.props.title === 'Delete chain?').props.open, true);
  assert.equal(popup.toasts.length, 0);
  failDelete(new Error('Storage unavailable'));
  await deleting;
  assert.equal(popup.find(popup.render(), node => node.props.title === 'Delete chain?').props.open, true);
  assert.equal(popup.toasts[0].variant, 'error');
});
