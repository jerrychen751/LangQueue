import test from 'node:test';
import assert from 'node:assert/strict';

class FakeTextarea {
  constructor(value) { this.value = value; this.selectionStart = value.length; }
  getBoundingClientRect() { return {}; }
}
globalThis.HTMLTextAreaElement = FakeTextarea;
globalThis.HTMLElement = class {};
const { detectShortcutContext } = await import('../src/content/shortcut_trigger.ts');

test('a $ at the start, after a space, or on a new line opens shortcuts', () => {
  assert.equal(detectShortcutContext(new FakeTextarea('$sum'))?.query, 'sum');
  assert.equal(detectShortcutContext(new FakeTextarea('please $'))?.query, '');
  assert.equal(detectShortcutContext(new FakeTextarea('hello\n$sum'))?.query, 'sum');
});

test('prices and mid-word dollars do not open shortcuts', () => {
  assert.equal(detectShortcutContext(new FakeTextarea('The total is $5')), null);
  assert.equal(detectShortcutContext(new FakeTextarea('$1,000')), null);
  assert.equal(detectShortcutContext(new FakeTextarea('US$5')), null);
});
