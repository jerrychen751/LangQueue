import type { ShortcutContext } from '../shortcut_trigger';

type InputElement = HTMLTextAreaElement | HTMLElement;

function inferInputType(data: string): InputEventInit['inputType'] {
  if (/[\r\n\t]/.test(data) || / {2,}/.test(data)) {
    return 'insertFromPaste';
  }
  return 'insertText';
}

function dispatchFrameworkBeforeInput(el: HTMLElement, data: string, inputType: InputEventInit['inputType']) {
  try {
    const evt = new InputEvent('beforeinput', { bubbles: true, cancelable: true, data, inputType } as InputEventInit);
    el.dispatchEvent(evt);
  } catch {
    void 0;
  }
}

function dispatchFrameworkInput(el: HTMLElement, data: string, inputType: InputEventInit['inputType']) {
  try {
    const ie = new InputEvent('input', { bubbles: true, data, inputType } as InputEventInit);
    el.dispatchEvent(ie);
  } catch {
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }
}

function setTextareaValue(el: HTMLTextAreaElement, value: string) {
  const nativeSetter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
  nativeSetter?.call(el, value);
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.focus();
}

function setContentEditableValue(el: HTMLElement, value: string) {
  el.focus();
  const inputType = inferInputType(value);
  dispatchFrameworkBeforeInput(el, value, inputType);
  const selection = window.getSelection();
  const range = document.createRange();
  range.selectNodeContents(el);
  range.deleteContents();
  range.insertNode(buildParagraphFragment(value));
  const after = document.createRange();
  after.selectNodeContents(el);
  after.collapse(false);
  selection?.removeAllRanges();
  selection?.addRange(after);
  dispatchFrameworkInput(el, value, inputType);
}

// ProseMirror (ChatGPT, Claude) and Quill (Gemini) keep one <p> per line, so a bare <br> gets rebuilt into extra empty paragraphs
function buildParagraphFragment(value: string): DocumentFragment {
  const fragment = document.createDocumentFragment();
  for (const line of value.split(/\r\n|\r|\n/)) {
    const paragraph = document.createElement('p');
    paragraph.appendChild(line ? document.createTextNode(line) : document.createElement('br'));
    fragment.appendChild(paragraph);
  }
  return fragment;
}

export function getInputText(el: InputElement | null): string {
  if (!el) {
    return '';
  }
  if (el instanceof HTMLTextAreaElement) {
    return el.value || '';
  }
  const blocks = Array.from(el.children);
  if (blocks.length && el.childNodes.length === blocks.length && blocks.every(block => block.tagName === 'P')) {
    // innerText puts a blank line between paragraphs, and a paragraph's closing <br> only keeps an empty line visible
    return blocks.map(block => {
      const text = (block as HTMLElement).innerText || '';
      return block.lastChild?.nodeName === 'BR' && text.endsWith('\n') ? text.slice(0, -1) : text;
    }).join('\n');
  }
  return el.innerText || '';
}

export function isSameComposerText(actual: string, expected: string) {
  return actual.replace(/\s+/g, ' ').trim() === expected.replace(/\s+/g, ' ').trim();
}

export function setInputText(el: InputElement, value: string) {
  if (el instanceof HTMLTextAreaElement) {
    setTextareaValue(el, value);
  } else {
    setContentEditableValue(el, value);
  }
}

export function appendInputText(el: InputElement, value: string) {
  if (el instanceof HTMLTextAreaElement) {
    const existing = el.value || '';
    const next = existing ? `${existing}\n${value}` : value;
    setTextareaValue(el, next);
    const len = next.length;
    try {
      el.setSelectionRange(len, len);
    } catch {
      void 0;
    }
  } else {
    const existing = getInputText(el);
    setContentEditableValue(el, existing ? `${existing}\n${value}` : value);
  }
}

export function replaceShortcutContext(context: ShortcutContext, replacement: string) {
  if (context.kind === 'textarea') {
    const { input, start, end } = context;
    input.setRangeText(replacement, start, end, 'end');
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.focus();
    return;
  }

  const before = context.textBefore.slice(0, context.shortcutIndex);
  const next = `${before}${replacement}${context.textAfter}`;
  setContentEditableValue(context.input, next);
}
