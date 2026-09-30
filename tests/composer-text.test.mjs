import test from 'node:test';
import assert from 'node:assert/strict';
import { getInputText, isSameComposerText } from '../src/content/composer/composer_text.ts';

globalThis.HTMLTextAreaElement = class {};

function createParagraph(text, endsWithBreak = false) {
  return { tagName: 'P', innerText: endsWithBreak ? `${text}\n` : text, lastChild: { nodeName: endsWithBreak ? 'BR' : '#text' } };
}

function createEditor(...children) {
  return { children, childNodes: children, innerText: children.map(child => child.innerText).join('\n\n') };
}

test('editor paragraphs read back as single newlines with empty lines kept', () => {
  const lines = createEditor(createParagraph('Line one'), createParagraph('', true), createParagraph('Line three'));
  assert.equal(getInputText(lines), 'Line one\n\nLine three');
});

test('an empty editor paragraph reads as empty text', () => {
  assert.equal(getInputText(createEditor(createParagraph('', true))), '');
});

test('a hard break inside a paragraph keeps its newline', () => {
  assert.equal(getInputText(createEditor({ tagName: 'P', innerText: 'first\nsecond', lastChild: { nodeName: '#text' } })), 'first\nsecond');
});

test('non-paragraph editor content falls back to innerText', () => {
  const list = { tagName: 'UL', innerText: 'one\ntwo', lastChild: { nodeName: 'LI' } };
  assert.equal(getInputText(createEditor(createParagraph('Intro'), list)), 'Intro\n\none\ntwo');
});

test('composer text comparison ignores whitespace layout but not wording', () => {
  assert.equal(isSameComposerText('Line one\n\n\nLine two\n', 'Line one\nLine two'), true);
  assert.equal(isSameComposerText('Line one  Line two', 'Line one Line two'), true);
  assert.equal(isSameComposerText('Line one\nLine 2', 'Line one\nLine two'), false);
});
