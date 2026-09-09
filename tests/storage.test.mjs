import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import test from 'node:test';
import vm from 'node:vm';

const require = createRequire(resolve('package.json'));
const ts = require('typescript');
const source = ts.transpileModule(readFileSync(resolve('src/utils/storage.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

function createStorageContexts(initial = {}) {
  const records = structuredClone(initial);
  let pending = Promise.resolve();
  let shouldFailWrite = false;
  const attachments = new Map();
  const chrome = {
    storage: {
      local: {
        async get(keys) {
          const result = Object.fromEntries(keys.map((key) => [key, structuredClone(records[key])]));
          await new Promise((resolve) => setImmediate(resolve));
          return result;
        },
        async set(values) {
          await new Promise((resolve) => setImmediate(resolve));
          if (shouldFailWrite) {
            shouldFailWrite = false;
            throw new Error('Storage write failed');
          }
          Object.assign(records, structuredClone(values));
        },
        async remove(keys) {
          for (const key of keys) delete records[key];
        },
      },
    },
  };
  const navigator = {
    locks: {
      request(name, callback) {
        assert.equal(name, 'langqueue-storage');
        const result = pending.then(callback);
        pending = result.catch(() => {});
        return result;
      },
    },
  };
  function loadStorage() {
    const exports = {};
    vm.runInNewContext(source, {
      exports,
      chrome,
      navigator,
      require(path) {
        if (path === '../types') return { CURRENT_SCHEMA_VERSION: 3, CURRENT_CHAINS_SCHEMA_VERSION: 2 };
        if (path === './attachments') return {
          inferAttachmentKind: () => 'file',
          listAttachmentMetas: async () => [...attachments.values()],
          deleteAttachment: async (id) => { attachments.delete(id); },
          exportAttachmentRecords: async () => [],
          importAttachmentRecords: async (items) => {
            for (const item of items) attachments.set(item.id, item);
            return items.length;
          },
        };
        throw new Error(`Unexpected import: ${path}`);
      },
    });
    return exports;
  }
  return {
    popup: loadStorage(),
    background: loadStorage(),
    records,
    attachments,
    failNextWrite() { shouldFailWrite = true; },
  };
}

function createPrompt(id = 'p1') {
  return { id, title: id, content: 'original', attachments: [], usageCount: 0, createdAt: 1, updatedAt: 1 };
}

function createLibrary() {
  return {
    langqueue_prompts: { meta: { schemaVersion: 3, createdAt: 1, updatedAt: 1 }, promptsById: { p1: createPrompt() } },
    langqueue_chains: { version: 2, updatedAt: 1, items: [] },
    langqueue_usage: { totalUses: 0, logs: [] },
  };
}

test('editing a prompt and logging usage in separate contexts preserves both writes', async () => {
  const { popup, background } = createStorageContexts(createLibrary());
  await Promise.all([
    popup.updatePrompt('p1', { content: 'edited' }),
    background.logUsage({ promptId: 'p1', timestamp: 20, source: 'test' }),
  ]);
  const prompt = await popup.getPrompt('p1');
  assert.equal(prompt.content, 'edited');
  assert.equal(prompt.usageCount, 1);
  assert.equal(prompt.lastUsedAt, 20);
});

test('simultaneous usage events preserve every count and log', async () => {
  const { popup, background, records } = createStorageContexts(createLibrary());
  await Promise.all(Array.from({ length: 12 }, (_, index) => (index % 2 ? popup : background).logUsage({ promptId: 'p1', timestamp: index, source: 'test' })));
  assert.equal((await popup.getPrompt('p1')).usageCount, 12);
  assert.equal(records.langqueue_usage.totalUses, 12);
  assert.equal(records.langqueue_usage.logs.length, 12);
});

test('first reads cannot overwrite a concurrent prompt creation', async () => {
  const { popup, background } = createStorageContexts();
  await Promise.all([popup.savePrompt(createPrompt('new')), background.getAllPrompts()]);
  assert.equal((await background.getPrompt('new')).content, 'original');
});

test('a rejected mutation releases the lock for the next writer', async () => {
  const { popup, background, failNextWrite } = createStorageContexts(createLibrary());
  failNextWrite();
  await assert.rejects(popup.updatePrompt('p1', { content: 'fails' }), /Storage write failed/);
  await background.updatePrompt('p1', { content: 'succeeds' });
  assert.equal((await popup.getPrompt('p1')).content, 'succeeds');
});

test('combined imports finish without nested locks and retain referenced attachments', async () => {
  const { popup, attachments } = createStorageContexts(createLibrary());
  const attachment = { id: 'a1', name: 'test.txt', mimeType: 'text/plain', size: 1, kind: 'file', createdAt: 1, dataBase64: 'YQ==' };
  const result = await popup.importLibrary({
    version: 3,
    exportedAt: 1,
    prompts: [{ ...createPrompt('imported'), attachments: [attachment] }],
    chains: [{ id: 'c1', title: 'chain', steps: [{ content: 'step', attachments: [attachment] }], createdAt: 1, updatedAt: 1 }],
    attachments: [attachment],
  });
  assert.equal(result.prompts.imported, 1);
  assert.equal(result.chains.imported, 1);
  assert.equal(attachments.size, 1);
});

test('concurrent first reads share one initialized library', async () => {
  const { popup, background } = createStorageContexts();
  const [first, second] = await Promise.all([popup.getAllPrompts(), background.getAllPrompts()]);
  assert.equal(JSON.stringify(first), JSON.stringify(second));
});

test('simultaneous chain saves preserve both chains', async () => {
  const { popup, background } = createStorageContexts(createLibrary());
  await Promise.all([
    popup.saveChain({ id: 'c1', title: 'first', steps: [], createdAt: 1, updatedAt: 1 }),
    background.saveChain({ id: 'c2', title: 'second', steps: [], createdAt: 1, updatedAt: 1 }),
  ]);
  assert.equal((await popup.getAllChains()).length, 2);
});
