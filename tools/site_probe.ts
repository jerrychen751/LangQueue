// Runs inside a live chat page or a replayed fixture; scripts/check-sites.mjs and tests/site-replay.test.mjs drive it through LangQueueProbe
import type { Adapter } from '../src/content/adapters/adapter';
import { createChatGPTAdapter } from '../src/content/adapters/chatgpt';
import { createClaudeAdapter } from '../src/content/adapters/claude';
import { createGeminiAdapter } from '../src/content/adapters/gemini';
import { getInputText, isSameComposerText, setInputText } from '../src/content/composer/composer_text';

const adapter: Adapter | null = [createChatGPTAdapter(), createClaudeAdapter(), createGeminiAdapter()].find(entry => entry.matchesAdapterDomain()) ?? null;
const baseline = new WeakSet<Element>();
let files: File[] = [];
let popups: Element[] = [];

function requireAdapter(): Adapter {
  if (!adapter) {
    throw new Error(`No LangQueue adapter matches ${location.hostname}.`);
  }
  return adapter;
}

function describeElement(element: Element | null) {
  if (!element) {
    return null;
  }
  return {
    tag: element.localName,
    id: element.id || null,
    testid: element.getAttribute('data-testid'),
    ariaLabel: element.getAttribute('aria-label'),
  };
}

export function inspect() {
  const site = requireAdapter();
  const input = site.getInputElement();
  const send = input ? site.getSendButton(input) : null;
  const expectedInput = document.querySelector('[data-lq-expected="input"]');
  const expectedSend = document.querySelector('[data-lq-expected="send"]');
  return {
    site: site.id,
    href: location.href,
    input: describeElement(input),
    inputText: input ? getInputText(input) : null,
    generating: site.isGenerating(),
    send: describeElement(send),
    inputIsExpected: expectedInput ? input === expectedInput : null,
    sendIsExpected: expectedSend ? send === expectedSend : null,
  };
}

// Applies the comparison LangQueue makes before it sends, which ignores whitespace differences
export function hasComposerText(text: string) {
  const input = requireAdapter().getInputElement();
  return Boolean(input) && isSameComposerText(getInputText(input), text);
}

export function typeText(text: string) {
  const input = requireAdapter().getInputElement();
  if (!input) {
    throw new Error('The chat input was not found.');
  }
  setInputText(input, text);
  return getInputText(input);
}

export function clickSend() {
  return requireAdapter().clickSend();
}

export function waitForIdle(timeoutMs: number) {
  return requireAdapter().waitForIdle({ timeoutMs, pollMs: 250 });
}

// Marks the input and send button that a verified live step used, so replay can require the adapter to find the same elements
export function markExpected() {
  const site = requireAdapter();
  for (const element of document.querySelectorAll('[data-lq-expected]')) {
    element.removeAttribute('data-lq-expected');
  }
  const input = site.getInputElement();
  input?.setAttribute('data-lq-expected', 'input');
  const send = input ? site.getSendButton(input) : null;
  send?.setAttribute('data-lq-expected', 'send');
}

export function markBaseline() {
  for (const element of document.querySelectorAll('*')) {
    baseline.add(element);
  }
}

export async function attachFiles(specs: { name: string; type: string; base64: string }[]) {
  files = specs.map(spec => new File([Uint8Array.from(atob(spec.base64), char => char.charCodeAt(0))], spec.name, { type: spec.type }));
  popups = [];
  // Records any popup the adapter opens to reach an uploader, such as Gemini's upload menu, so a replay can show the same markup when the adapter clicks
  const before = new WeakSet(document.querySelectorAll('*'));
  const scratch = document.implementation.createHTMLDocument('');
  const observer = new MutationObserver(() => {
    const roots = Array.from(document.querySelectorAll('*')).filter(element => !before.has(element) && element.parentElement && before.has(element.parentElement) && element.querySelector('input[type="file"], [role="menu"]'));
    if (!roots.some(root => root.querySelector('input[type="file"]'))) {
      return;
    }
    popups = roots.map((root, index) => {
      root.parentElement!.setAttribute('data-lq-popup-parent', String(index));
      const copy = copyElement(scratch, root, true, [], []);
      copy?.setAttribute('data-lq-popup-for', String(index));
      return copy;
    }).filter(copy => copy !== null);
  });
  observer.observe(document.body, { childList: true, subtree: true });
  try {
    return await requireAdapter().attachFiles(files);
  } finally {
    observer.disconnect();
  }
}

export function waitForUploads(timeoutMs: number) {
  return requireAdapter().waitForUploadsComplete({ files, timeoutMs, pollMs: 250 });
}

// Replays an upload against a captured fixture: the nodes the site added during the live upload leave the page before attachFiles and return after it, and a click on a popup trigger shows the popup recorded on the live site
export async function replayUpload(specs: { name: string; type: string; base64: string }[], timeoutMs: number) {
  const added = Array.from(document.querySelectorAll('[data-lq-added]')).filter(element => !element.parentElement?.closest('[data-lq-added]'));
  const positions = added.map(element => ({ element, parent: element.parentNode!, next: element.nextSibling }));
  for (const element of added) {
    element.remove();
  }
  const recorded = Array.from(document.querySelectorAll<HTMLTemplateElement>('template[data-lq-popup]'), template => template.content.firstElementChild!);
  function showPopups(event: Event) {
    const trigger = (event.target as Element).closest('[aria-haspopup]');
    if (!trigger) {
      return;
    }
    for (const popup of recorded) {
      const parent = document.querySelector(`[data-lq-popup-parent="${popup.getAttribute('data-lq-popup-for')}"]`) || document.body;
      parent.append(document.importNode(popup, true));
    }
    trigger.setAttribute('aria-expanded', 'true');
  }
  document.addEventListener('click', showPopups, true);
  const attached = await attachFiles(specs).finally(() => document.removeEventListener('click', showPopups, true));
  for (const { element, parent, next } of positions.reverse()) {
    parent.insertBefore(element, next);
  }
  return { added: added.length, attached, uploaded: attached.ok ? await waitForUploads(timeoutMs) : false };
}

// Copies a live element for a public fixture. Outside the composer regions, text becomes an ellipsis and free-text attributes are dropped, because sidebars, greetings, and account menus carry the user's name and history
function copyElement(output: Document, source: Element, inRegion: boolean, regions: Element[], landmarks: Element[]): Element | null {
  if (['script', 'style', 'link', 'noscript', 'iframe', 'template', 'canvas', 'video', 'audio', 'object', 'embed', 'meta'].includes(source.localName) || landmarks.includes(source)) {
    return null;
  }
  inRegion ||= regions.includes(source);
  const copy = source.namespaceURI === 'http://www.w3.org/1999/xhtml' ? output.createElement(source.localName) : output.createElementNS(source.namespaceURI, source.localName);
  for (const attribute of source.attributes) {
    if (['href', 'srcset', 'style', 'nonce', 'integrity'].includes(attribute.name) || attribute.name.startsWith('on')) {
      continue;
    }
    if (!inRegion && ['aria-label', 'aria-description', 'title', 'alt', 'placeholder', 'data-placeholder', 'value', 'aria-valuetext'].includes(attribute.name)) {
      continue;
    }
    let value = attribute.value;
    // Images from other hosts are avatars and account art, and same-origin paths keep only their path
    if (attribute.name === 'src' && value.startsWith('data:')) {
      value = 'data:,';
    } else if (attribute.name === 'src' && !value.startsWith('blob:')) {
      const url = new URL(value, location.href);
      value = url.origin === location.origin ? url.pathname : '';
    }
    copy.setAttribute(attribute.name, scrubIdentifiers(value));
  }
  const display = getComputedStyle(source).display;
  if (display === 'none' || display === 'contents') {
    copy.setAttribute('style', `display: ${display}`);
  }
  if (!baseline.has(source) && source.parentElement && baseline.has(source.parentElement)) {
    copy.setAttribute('data-lq-added', '');
  }
  if (source instanceof HTMLTextAreaElement) {
    copy.textContent = source.value;
    return copy;
  }
  if (source.localName === 'svg') {
    return copy;
  }
  for (const child of source.childNodes) {
    if (child.nodeType === Node.TEXT_NODE) {
      const text = child.textContent || '';
      copy.append(output.createTextNode(inRegion ? scrubIdentifiers(text) : text.trim() ? '…' : text));
    } else if (child.nodeType === Node.ELEMENT_NODE) {
      const element = copyElement(output, child as Element, inRegion, regions, landmarks);
      if (element) {
        copy.append(element);
      }
    }
  }
  return copy;
}

// UUIDs can name the user's organization or account, and emails name the user
function scrubIdentifiers(value: string) {
  return value.replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, 'user@example.com').replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '00000000-0000-0000-0000-000000000000');
}

// The composer region is the highest ancestor of the input with at most 1500 characters of text, plus the elements it names through aria-describedby or aria-labelledby, which hold Gemini's attachment names
export function captureSnapshot(meta: Record<string, unknown>) {
  const output = document.implementation.createHTMLDocument('');
  let region: Element | null = requireAdapter().getInputElement();
  if (!region) {
    throw new Error('The chat input was not found.');
  }
  while (region.parentElement && region.parentElement !== document.body && region.parentElement.innerText.length <= 1500) {
    region = region.parentElement;
  }
  const composer = region;
  const references = Array.from(composer.querySelectorAll('[aria-describedby], [aria-labelledby]'), element => `${element.getAttribute('aria-describedby') || ''} ${element.getAttribute('aria-labelledby') || ''}`.split(/\s+/)).flat();
  const regions = [composer, ...references.map(id => id && document.getElementById(id)).filter(element => element instanceof Element)];
  const landmarks = Array.from(document.querySelectorAll('nav, aside, header, footer, [role="navigation"], [role="banner"], [role="complementary"], [role="contentinfo"]')).filter(landmark => !landmark.contains(composer));
  const body = copyElement(output, document.body, false, regions, landmarks)!;
  for (const popup of popups) {
    const template = output.createElement('template');
    template.setAttribute('data-lq-popup', '');
    template.content.append(output.importNode(popup, true));
    body.append(template);
  }
  const charset = output.createElement('meta');
  charset.setAttribute('charset', 'utf-8');
  const marker = output.createElement('meta');
  marker.setAttribute('name', 'langqueue-fixture');
  marker.setAttribute('content', JSON.stringify({ ...meta, url: scrubIdentifiers(location.href), capturedAt: new Date().toISOString() }));
  output.head.append(charset, marker);
  output.body.replaceWith(body);
  return `<!doctype html>\n${output.documentElement.outerHTML}\n`;
}
