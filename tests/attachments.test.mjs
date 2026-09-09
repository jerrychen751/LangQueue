import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import test from 'node:test';
import vm from 'node:vm';

const require = createRequire(resolve('package.json'));
const ts = require('typescript');
const source = ts.transpileModule(readFileSync(resolve('src/utils/attachments.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

function createAttachmentStorage() {
  let transaction;
  let openCount = 0;
  let operation;
  const exports = {};
  const indexedDB = {
    open() {
      openCount++;
      const request = {};
      queueMicrotask(() => {
        request.result = {
          transaction() {
            transaction = {
              objectStore() {
                return {
                  put() {
                    operation = 'put';
                    const request = {};
                    queueMicrotask(() => request.onsuccess?.());
                    return request;
                  },
                  delete() { operation = 'delete'; return {}; },
                  getAllKeys() {
                    operation = 'getAllKeys';
                    const request = {};
                    queueMicrotask(() => { request.result = ['a1', 'a2']; request.onsuccess(); });
                    return request;
                  },
                  getAll() { throw new Error('Binary enumeration must not occur'); },
                };
              },
            };
            return transaction;
          },
        };
        request.onsuccess();
      });
      return request;
    },
  };
  vm.runInNewContext(source, { exports, indexedDB, crypto, atob, btoa, File });
  return { api: exports, getTransaction: () => transaction, getOpenCount: () => openCount, getOperation: () => operation };
}

test('creating and abandoning an attachment draft never opens persistent storage', () => {
  const { api, getOpenCount } = createAttachmentStorage();
  const file = new File(['draft'], 'draft.txt', { type: 'text/plain' });
  const ref = api.createAttachmentDraft(file);
  assert.equal(ref.size, file.size);
  assert.equal(ref.name, file.name);
  assert.equal(getOpenCount(), 0);
});

test('a successful put request followed by transaction abort rejects the save', async () => {
  const { api, getTransaction, getOperation } = createAttachmentStorage();
  const saving = api.saveAttachmentFile(new File(['draft'], 'draft.txt', { type: 'text/plain' }));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(getOperation(), 'put');
  getTransaction().onabort();
  await assert.rejects(saving, /transaction aborted/);
});

test('saving resolves only after the write transaction commits', async () => {
  const { api, getTransaction } = createAttachmentStorage();
  let settled = false;
  const saving = api.saveAttachmentFile(new File(['draft'], 'draft.txt', { type: 'text/plain' })).then(() => { settled = true; });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(settled, false);
  getTransaction().oncomplete();
  await saving;
  assert.equal(settled, true);
});

test('deleting rejects when its transaction aborts', async () => {
  const { api, getTransaction } = createAttachmentStorage();
  const deleting = api.deleteAttachment('a1');
  await new Promise((resolve) => setImmediate(resolve));
  getTransaction().onabort();
  await assert.rejects(deleting, /transaction aborted/);
});

test('cleanup enumerates attachment keys without loading binary records', async () => {
  const { api, getOperation } = createAttachmentStorage();
  assert.equal(JSON.stringify(await api.listAttachmentIds()), JSON.stringify(['a1', 'a2']));
  assert.equal(getOperation(), 'getAllKeys');
});

test('attachment preflight rejects invalid size, excessive payloads, and duplicates without opening storage', () => {
  const { api, getOpenCount } = createAttachmentStorage();
  const record = { id: 'a1', name: 'file.txt', mimeType: 'text/plain', size: 1, dataBase64: 'YQ==', kind: 'file', createdAt: 1 };
  assert.throws(() => api.prepareAttachmentImports([{ ...record, size: 2 }]), /size does not match/);
  assert.throws(() => api.prepareAttachmentImports([{ ...record, size: 26 * 1024 * 1024 }]), /25 MB limit/);
  assert.throws(() => api.prepareAttachmentImports([record, record]), /duplicate attachment/);
  assert.equal(getOpenCount(), 0);
});

test('attachment preflight rejects metadata that file storage would normalize differently', () => {
  const { api, getOpenCount } = createAttachmentStorage();
  const record = { id: 'a1', name: 'file.txt', mimeType: 'text/plain', size: 1, dataBase64: 'YQ==', kind: 'file', createdAt: 1 };
  assert.throws(() => api.prepareAttachmentImports([{ ...record, kind: 'image' }]), /kind does not match/);
  assert.throws(() => api.prepareAttachmentImports([{ ...record, mimeType: 'TEXT/PLAIN' }]), /canonical lowercase form/);
  assert.throws(() => api.prepareAttachmentImports([{ ...record, mimeType: '' }]), /Invalid/);
  assert.equal(getOpenCount(), 0);
});
