import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import test from 'node:test';
import vm from 'node:vm';

const require = createRequire(resolve('package.json'));
const ts = require('typescript');
const source = ts.transpileModule(readFileSync(resolve('src/library/storage.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

const attachmentExports = {};
vm.runInNewContext(ts.transpileModule(readFileSync(resolve('src/library/attachments.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, { exports: attachmentExports, File, crypto, atob, btoa });

function createStorageContexts(initial = {}) {
  const records = structuredClone(initial);
  let pending = Promise.resolve();
  let shouldFailWrite = false;
  let shouldFailCleanup = false;
  const writes = [];
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
          writes.push(structuredClone(values));
          Object.assign(records, structuredClone(values));
        },
        async remove(keys) {
          for (const key of keys) {
            delete records[key];
          }
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
      File,
      crypto,
      require(path) {
        if (path === './model') {
          return { CURRENT_SCHEMA_VERSION: 3, CURRENT_CHAINS_SCHEMA_VERSION: 2 };
        }
        if (path === './attachments') {
          return {
          inferAttachmentKind: () => 'file',
          listAttachmentIds: async () => {
            if (shouldFailCleanup) {
              throw new Error("Cleanup failed");
            }
            return [...attachments.keys()];
          },
          getAttachmentMeta: async (id) => attachments.get(id) ?? null,
          prepareAttachmentImports: attachmentExports.prepareAttachmentImports,
          saveAttachmentFile: async (file, id) => {
            const bytes = await file.arrayBuffer();
            attachments.set(id, { id, bytes, name: file.name, mimeType: file.type, size: file.size, kind: 'file', createdAt: 1 });
          },
          deleteAttachment: async (id) => { attachments.delete(id); },
          exportAttachmentRecords: async (ids) => ids.map((id) => {
            const { bytes, ...ref } = attachments.get(id);
            return { ...ref, dataBase64: Buffer.from(bytes).toString('base64') };
          }),
        };
        }
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
    writes,
    failCleanup() { shouldFailCleanup = true; },
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

test('unrelated edits cannot collect files held by an unsaved draft', async () => {
  const { popup, background, attachments } = createStorageContexts(createLibrary());
  const file = new File(['draft contents'], 'draft.txt', { type: 'text/plain' });
  const ref = { id: 'draft', name: file.name, mimeType: file.type, size: file.size, kind: 'file', createdAt: 1 };
  const pending = new Map([[ref.id, file]]);
  await background.updatePrompt('p1', { content: 'unrelated change' });
  assert.equal(attachments.size, 0);
  await popup.savePrompt({ ...createPrompt('draft-prompt'), attachments: [ref] }, pending);
  assert.equal(new TextDecoder().decode(attachments.get(ref.id).bytes), 'draft contents');
  assert.equal((await popup.getPrompt('draft-prompt')).attachments[0].id, ref.id);
});

test('failed metadata saves remove newly written binaries and retain pending files for retry', async () => {
  const { popup, attachments, failNextWrite } = createStorageContexts(createLibrary());
  const file = new File(['draft'], 'draft.txt', { type: 'text/plain' });
  const ref = { id: 'draft', name: file.name, mimeType: file.type, size: file.size, kind: 'file', createdAt: 1 };
  const pending = new Map([[ref.id, file]]);
  failNextWrite();
  await assert.rejects(popup.updatePrompt('p1', { attachments: [ref] }, pending), /Storage write failed/);
  assert.equal(attachments.size, 0);
  assert.equal((await popup.getPrompt('p1')).attachments.length, 0);
  assert.equal(pending.size, 1);
  await popup.updatePrompt('p1', { attachments: [ref] }, pending);
  assert.equal(attachments.size, 1);
});

test('binary failure leaves chain metadata unchanged and removes earlier new files', async () => {
  const { popup, attachments } = createStorageContexts(createLibrary());
  const pending = new Map([
    ['first', new File(['first'], 'first.txt', { type: 'text/plain' })],
    ['second', { arrayBuffer: async () => { throw new Error('Binary failed'); } }],
  ]);
  await assert.rejects(popup.saveChain({ id: 'new', title: 'new', steps: [], createdAt: 1, updatedAt: 1 }, pending), /Binary failed/);
  assert.equal(attachments.size, 0);
  assert.equal((await popup.getAllChains()).length, 0);
});

function createBackupAttachment(id = 'a1', contents = 'new') {
  return { id, name: 'file.txt', mimeType: 'text/plain', size: Buffer.byteLength(contents), kind: 'file', createdAt: 1, dataBase64: Buffer.from(contents).toString('base64') };
}

test('corrupt binary imports leave all previous metadata and files unchanged', async () => {
  const { popup, records, attachments, writes } = createStorageContexts(createLibrary());
  const before = structuredClone(records);
  const file = { ...createBackupAttachment(), dataBase64: '%%%' };
  await assert.rejects(popup.importLibrary({ version: 3, prompts: [{ ...createPrompt(), content: 'replacement', attachments: [file] }], chains: [], attachments: [file] }), /Invalid base64/);
  assert.deepEqual(records, before);
  assert.equal(attachments.size, 0);
  assert.equal(writes.length, 0);
});

test('metadata write failure rolls back staged imports without changing the existing library', async () => {
  const { popup, records, attachments, failNextWrite } = createStorageContexts(createLibrary());
  const before = structuredClone(records);
  const file = createBackupAttachment();
  failNextWrite();
  await assert.rejects(popup.importLibrary({ version: 3, prompts: [{ ...createPrompt(), content: 'replacement', attachments: [file] }], chains: [], attachments: [file] }), /Storage write failed/);
  assert.deepEqual(records, before);
  assert.equal(attachments.size, 0);
});

test('attachment ID collisions preserve old bytes and publish remapped metadata in one write', async () => {
  const initial = createLibrary();
  const old = createBackupAttachment('shared', 'old');
  initial.langqueue_prompts.promptsById.p1.attachments = [old];
  const { popup, records, attachments, writes } = createStorageContexts(initial);
  attachments.set(old.id, { ...old, bytes: new TextEncoder().encode('old').buffer });
  const incoming = createBackupAttachment('shared', 'new');
  await popup.importLibrary({ version: 3, prompts: [{ ...createPrompt('p2'), attachments: [incoming] }], chains: [{ id: 'c1', title: 'chain', steps: [{ content: ' step\n', attachments: [incoming] }], createdAt: 1, updatedAt: 1 }], attachments: [incoming] });
  const remapped = records.langqueue_prompts.promptsById.p2.attachments[0].id;
  assert.notEqual(remapped, 'shared');
  assert.equal(records.langqueue_chains.items[0].steps[0].attachments[0].id, remapped);
  assert.equal(new TextDecoder().decode(attachments.get('shared').bytes), 'old');
  assert.equal(new TextDecoder().decode(attachments.get(remapped).bytes), 'new');
  assert.equal(writes.length, 1);
  assert.deepEqual(Object.keys(writes[0]).sort(), ['langqueue_chains', 'langqueue_prompts']);
});

test('unsupported backup versions are rejected before any write', async () => {
  const { popup, writes } = createStorageContexts();
  for (const backup of [{ version: 999, prompts: [createPrompt()] }, { version: 2, prompts: [], chains: [] }, { version: 0, chains: [] }]) {
    await assert.rejects(popup.importLibrary(backup), /Unsupported backup version/);
  }
  assert.equal(writes.length, 0);
});

test('metadata-only backups reject missing files and retain verified existing references', async () => {
  const { popup, writes, attachments, records } = createStorageContexts(createLibrary());
  const file = createBackupAttachment();
  const backup = { version: 2, prompts: [{ ...createPrompt('p2'), attachments: [file] }] };
  await assert.rejects(popup.importLibrary(backup), /Export again with attachment files included/);
  assert.equal(writes.length, 0);
  attachments.set(file.id, { ...file, bytes: new TextEncoder().encode('new').buffer });
  await popup.importLibrary(backup);
  assert.equal(records.langqueue_prompts.promptsById.p2.attachments[0].id, file.id);
  assert.equal(attachments.size, 1);
});

test('legacy prompt and chain imports preserve exact text and string steps', async () => {
  const { popup } = createStorageContexts(createLibrary());
  await popup.importLibrary({ version: 1, prompts: [{ id: 'legacy', title: 'legacy', content: '  exact\n\ntext\t' }] });
  await popup.importLibrary({ version: 1, chains: [{ id: 'legacy-chain', title: 'legacy', steps: ['  step one\n', 'step two\t'] }] });
  assert.equal((await popup.getPrompt('legacy')).content, '  exact\n\ntext\t');
  assert.equal((await popup.getAllChains())[0].steps[0].content, '  step one\n');
});

test('prompt import duplicate strategies keep their skip, replace, duplicate, and replace-library behavior', async () => {
  for (const strategy of ['skip', 'replace', 'duplicate']) {
    const { popup } = createStorageContexts(createLibrary());
    const counts = await popup.importPrompts({ version: 2, prompts: [{ ...createPrompt(), content: 'replacement' }] }, { mode: 'merge', duplicateStrategy: strategy });
    assert.equal(counts[strategy === 'skip' ? 'skipped' : strategy === 'replace' ? 'replaced' : 'duplicated'], 1);
    assert.equal((await popup.getPrompt('p1')).content, strategy === 'replace' ? 'replacement' : 'original');
    assert.equal((await popup.getAllPrompts()).length, strategy === 'duplicate' ? 2 : 1);
  }
  const { popup } = createStorageContexts(createLibrary());
  await popup.importPrompts({ version: 2, prompts: [createPrompt('new')] }, { mode: 'replace', duplicateStrategy: 'skip' });
  assert.equal(await popup.getPrompt('p1'), null);
  assert.equal((await popup.getAllPrompts()).length, 1);
});

test('cleanup failure after successful deletion does not report a failed delete', async () => {
  const initial = createLibrary();
  initial.langqueue_chains.items = [{ id: 'c1', title: 'chain', steps: [], createdAt: 1, updatedAt: 1 }];
  const { popup, failCleanup } = createStorageContexts(initial);
  failCleanup();
  await popup.deletePrompt('p1');
  await popup.deleteChain('c1');
  assert.equal(await popup.getPrompt('p1'), null);
  assert.equal((await popup.getAllChains()).length, 0);
});

test('import directly into legacy stored schemas preserves old records and publishes migrated envelopes once', async () => {
  for (const storedPrompts of [[{ id: 'old', title: 'old', content: ' old text\n' }], { meta: { schemaVersion: 1, createdAt: 1 }, prompts: [{ id: 'old', title: 'old', content: ' old text\n' }] }]) {
    const initial = { langqueue_prompts: storedPrompts, langqueue_chains: [{ id: 'old-chain', title: 'old', steps: [' old step\n'] }] };
    const { popup, records, writes } = createStorageContexts(initial);
    await popup.importLibrary({ version: 1, prompts: [{ id: 'new', title: 'new', content: ' new text\n' }] });
    assert.equal(records.langqueue_prompts.meta.schemaVersion, 3);
    assert.equal((await popup.getPrompt('old')).content, ' old text\n');
    assert.equal((await popup.getPrompt('new')).content, ' new text\n');
    assert.equal((await popup.getAllChains())[0].steps[0].content, ' old step\n');
    assert.equal(writes.length, 1);
  }
});

test('corrupt imports do not migrate or modify a legacy stored library', async () => {
  const initial = { langqueue_prompts: { prompts: [{ id: 'old', title: 'old', content: 'old' }] }, langqueue_chains: [] };
  const { popup, records, writes } = createStorageContexts(initial);
  const bad = { ...createBackupAttachment(), dataBase64: '%%%' };
  await assert.rejects(popup.importLibrary({ version: 3, prompts: [createPrompt()], chains: [], attachments: [bad] }), /Invalid base64/);
  assert.deepEqual(records, initial);
  assert.equal(writes.length, 0);
});

test('skipped prompt and chain duplicates do not require obsolete attachment files', async () => {
  const initial = createLibrary();
  initial.langqueue_chains.items = [{ id: 'c1', title: 'original', steps: [], createdAt: 1, updatedAt: 1 }];
  const { popup } = createStorageContexts(initial);
  const missing = createBackupAttachment('missing');
  const promptCounts = await popup.importPrompts({ version: 2, prompts: [{ ...createPrompt(), attachments: [missing] }] }, { mode: 'merge', duplicateStrategy: 'skip' });
  const chainCounts = await popup.importChains({ version: 2, chains: [{ id: 'c1', title: 'replacement', steps: [{ content: 'unused', attachments: [missing] }], createdAt: 1, updatedAt: 1 }] }, { mode: 'merge', duplicateStrategy: 'skip' });
  assert.equal(promptCounts.skipped, 1);
  assert.equal(chainCounts.skipped, 1);
  assert.equal((await popup.getPrompt('p1')).attachments.length, 0);
  assert.equal((await popup.getAllChains())[0].title, 'original');
});

test('accepted attachment metadata and bytes survive export and import into a fresh library', async () => {
  const first = createStorageContexts(createLibrary());
  const file = createBackupAttachment('source', 'round trip');
  await first.popup.importLibrary({ version: 3, prompts: [{ ...createPrompt('imported'), attachments: [file] }], chains: [], attachments: [file] });
  const exported = await first.popup.exportLibrary({ includeBinaries: true });
  const firstRef = exported.prompts.find((prompt) => prompt.id === 'imported').attachments[0];
  assert.equal(firstRef.mimeType, exported.attachments[0].mimeType);
  assert.equal(firstRef.kind, exported.attachments[0].kind);
  const second = createStorageContexts(createLibrary());
  await second.popup.importLibrary(exported);
  const secondRef = (await second.popup.getPrompt('imported')).attachments[0];
  assert.equal(secondRef.mimeType, 'text/plain');
  assert.equal(secondRef.kind, 'file');
  assert.equal(new TextDecoder().decode(second.attachments.get(secondRef.id).bytes), 'round trip');
});

test('inconsistent binary kinds and MIME casing reject imports without changing the library', async () => {
  const { popup, records, writes } = createStorageContexts(createLibrary());
  const before = structuredClone(records);
  for (const file of [{ ...createBackupAttachment(), kind: 'image' }, { ...createBackupAttachment(), mimeType: 'TEXT/PLAIN' }]) {
    await assert.rejects(popup.importLibrary({ version: 3, prompts: [{ ...createPrompt(), attachments: [file] }], chains: [], attachments: [file] }), /kind does not match|canonical lowercase form/);
  }
  assert.deepEqual(records, before);
  assert.equal(writes.length, 0);
});

test('markdown prompt imports skip existing and repeated titles in one write', async () => {
  const { popup, records, writes } = createStorageContexts(createLibrary());
  const result = await popup.importPromptDrafts([
    { title: 'p1', content: 'duplicate of an existing title' },
    { title: 'review', content: 'Review the diff.' },
    { title: ' review ', content: 'repeated inside the batch' },
    { title: 'plan', content: 'Plan the work.' },
    { title: '  ', content: 'untitled' },
  ]);
  assert.equal(result.imported, 2);
  assert.equal(result.skipped, 3);
  const prompts = Object.values(records.langqueue_prompts.promptsById);
  assert.deepEqual(prompts.map((prompt) => prompt.title).sort(), ['p1', 'plan', 'review']);
  assert.equal(prompts.find((prompt) => prompt.title === 'review').content, 'Review the diff.');
  assert.equal(writes.length, 1);
  const repeat = await popup.importPromptDrafts([{ title: 'plan', content: 'again' }]);
  assert.equal(repeat.imported, 0);
  assert.equal(repeat.skipped, 1);
  assert.equal(writes.length, 1);
});
