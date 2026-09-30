import test from 'node:test';
import assert from 'node:assert/strict';
import { createChatGPTAdapter } from '../src/content/adapters/chatgpt.ts';

function createFixture(context) {
  context.mock.timers.enable({ apis: ['Date', 'setTimeout'] });
  class FileInput {
    type = 'file';
    disabled = false;
    dispatchEvent() {}
  }
  class Button {
    disabled = false;
    offsetParent = {};
    attributes = {};
    getAttribute(name) { return this.attributes[name] || null; }
  }
  globalThis.HTMLInputElement = FileInput;
  globalThis.HTMLButtonElement = Button;
  globalThis.DataTransfer = class { files = []; items = { add: file => this.files.push(file) }; };
  globalThis.location = { href: 'https://chatgpt.com/c/upload-test' };
  const fileInput = new FileInput();
  const send = new Button();
  send.attributes['aria-label'] = 'Send';
  const removes = [];
  const indicators = [];
  const form = {
    isConnected: true,
    querySelectorAll(selector) {
      if (selector.includes('type="file"')) {
        return [fileInput];
      }
      if (selector.includes('button[aria-label="Send"]')) {
        return [send];
      }
      if (selector === 'button[aria-label^="Remove "]') {
        return removes;
      }
      return indicators;
    },
  };
  const input = { isConnected: true, closest: () => form };
  globalThis.document = { body: {}, documentElement: {} };
  const adapter = createChatGPTAdapter();
  adapter.getInputElement = () => input;
  // A tile holds a Remove button; accepted files also show a preview surface labeled with the file name
  function addTile(name, accepted = true, visible = true) {
    const preview = { getAttribute: () => name, getClientRects: () => [{}] };
    const tile = {
      images: [],
      getAttribute: () => null,
      getClientRects: () => visible ? [{}] : [],
      querySelectorAll: selector => selector === 'img' ? tile.images : accepted ? [preview] : [],
    };
    removes.push({ parentElement: tile, getAttribute: () => `Remove ${name}` });
    return tile;
  }
  async function tick(milliseconds) {
    context.mock.timers.tick(milliseconds);
    await Promise.resolve();
    await Promise.resolve();
  }
  return { adapter, form, input, send, indicators, addTile, tick };
}

test('ChatGPT waits for delayed accepted tiles and enabled send, ignoring hidden spinners', async context => {
  const fixture = createFixture(context);
  const files = [{ name: 'notes.txt' }];
  await fixture.adapter.attachFiles(files);
  let completed = false;
  const pending = fixture.adapter.waitForUploadsComplete({ files, pollMs: 5, timeoutMs: 50 }).then(result => { completed = true; return result; });
  await fixture.tick(5);
  assert.equal(completed, false);
  fixture.addTile('notes.txt');
  fixture.send.disabled = true;
  await fixture.tick(5);
  assert.equal(completed, false);
  fixture.send.disabled = false;
  let visible = true;
  fixture.indicators.push({ getClientRects: () => visible ? [{}] : [] });
  await fixture.tick(5);
  assert.equal(completed, false);
  visible = false;
  await fixture.tick(5);
  assert.equal(await pending, true);
});

for (const state of ['missing', 'rejected', 'hidden', 'wrong-name']) {
  test(`ChatGPT rejects ${state} attachment tiles`, async context => {
    const fixture = createFixture(context);
    const files = [{ name: 'notes.txt' }];
    await fixture.adapter.attachFiles(files);
    if (state !== 'missing') {
      fixture.addTile(state === 'wrong-name' ? 'other.txt' : 'notes.txt', state !== 'rejected', state !== 'hidden');
    }
    const pending = fixture.adapter.waitForUploadsComplete({ files, pollMs: 5, timeoutMs: 20 });
    await fixture.tick(21);
    assert.equal(await pending, false);
  });
}

test('ChatGPT requires every new file including duplicate names beyond preexisting tiles', async context => {
  const fixture = createFixture(context);
  fixture.addTile('notes.txt');
  const files = [{ name: 'notes.txt' }, { name: 'notes.txt' }, { name: 'other.txt' }];
  await fixture.adapter.attachFiles(files);
  let completed = false;
  const pending = fixture.adapter.waitForUploadsComplete({ files, pollMs: 5, timeoutMs: 50 }).then(result => { completed = true; return result; });
  fixture.addTile('notes.txt');
  fixture.addTile('other.txt');
  await fixture.tick(5);
  assert.equal(completed, false);
  fixture.addTile('notes.txt');
  await fixture.tick(5);
  assert.equal(await pending, true);
});

for (const change of ['navigation', 'detached-form', 'replaced-input', 'replaced-form', 'superseded-attempt']) {
  test(`ChatGPT stops upload wait after ${change}`, async context => {
    const fixture = createFixture(context);
    const files = [{ name: 'notes.txt' }];
    await fixture.adapter.attachFiles(files);
    const pending = fixture.adapter.waitForUploadsComplete({ files, pollMs: 5, timeoutMs: 50 });
    if (change === 'navigation') {
      location.href = 'https://chatgpt.com/c/other';
    }
    if (change === 'detached-form') {
      fixture.form.isConnected = false;
    }
    if (change === 'replaced-input') {
      fixture.adapter.getInputElement = () => ({});
    }
    if (change === 'replaced-form') {
      fixture.input.closest = () => ({});
    }
    if (change === 'superseded-attempt') {
      await fixture.adapter.attachFiles(files);
    }
    fixture.addTile('notes.txt');
    await fixture.tick(5);
    assert.equal(await pending, false);
  });
}

test('ChatGPT matches files that it renamed with a duplicate suffix', async context => {
  const fixture = createFixture(context);
  fixture.addTile('notes(1).txt');
  const files = [{ name: 'notes.txt' }, { name: 'image.png' }];
  await fixture.adapter.attachFiles(files);
  let completed = false;
  const pending = fixture.adapter.waitForUploadsComplete({ files, pollMs: 5, timeoutMs: 50 }).then(result => { completed = true; return result; });
  fixture.addTile('notes(2).txt');
  await fixture.tick(5);
  assert.equal(completed, false);
  fixture.addTile('image(1).png');
  await fixture.tick(5);
  assert.equal(await pending, true);
});

test('ChatGPT requires matching files and consumes successful upload attempts', async context => {
  const fixture = createFixture(context);
  const files = [{ name: 'notes.txt' }];
  await fixture.adapter.attachFiles(files);
  fixture.addTile('notes.txt');
  assert.equal(await fixture.adapter.waitForUploadsComplete(), false);
  assert.equal(await fixture.adapter.waitForUploadsComplete({ files: [{ name: 'notes.txt' }] }), false);
  assert.equal(await fixture.adapter.waitForUploadsComplete({ files }), true);
  assert.equal(await fixture.adapter.waitForUploadsComplete({ files }), false);
});

test('ChatGPT does not accept a stop button as an upload-ready send control', async context => {
  const fixture = createFixture(context);
  const files = [{ name: 'notes.txt' }];
  await fixture.adapter.attachFiles(files);
  fixture.addTile('notes.txt');
  fixture.send.attributes['aria-label'] = 'Stop streaming';
  const pending = fixture.adapter.waitForUploadsComplete({ files, pollMs: 5, timeoutMs: 20 });
  await fixture.tick(21);
  assert.equal(await pending, false);
});

test('ChatGPT waits for image previews to load alongside document attachments', async context => {
  const fixture = createFixture(context);
  const files = [{ name: 'image.png' }, { name: 'notes.txt' }];
  await fixture.adapter.attachFiles(files);
  fixture.addTile('notes.txt');
  const image = { complete: false, naturalWidth: 64, naturalHeight: 64 };
  fixture.addTile('image.png').images.push(image);
  let completed = false;
  const pending = fixture.adapter.waitForUploadsComplete({ files, pollMs: 5, timeoutMs: 30 }).then(result => { completed = true; return result; });
  await fixture.tick(5);
  assert.equal(completed, false);
  image.complete = true;
  await fixture.tick(5);
  assert.equal(await pending, true);
});

test('ChatGPT rejects broken image previews', async context => {
  const fixture = createFixture(context);
  const files = [{ name: 'image.png' }];
  await fixture.adapter.attachFiles(files);
  fixture.addTile('image.png').images.push({ complete: true, naturalWidth: 0, naturalHeight: 0 });
  const pending = fixture.adapter.waitForUploadsComplete({ files, pollMs: 5, timeoutMs: 20 });
  await fixture.tick(21);
  assert.equal(await pending, false);
});
