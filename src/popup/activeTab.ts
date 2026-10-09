import type { ChainStep, InsertPromptResult } from '../messaging/request_types';
import type { AttachmentRef, Platform } from '../library/model';
import { sendToTab } from '../messaging/requests';

function getActiveTab(): Promise<chrome.tabs.Tab | undefined> {
  return new Promise((resolve) => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => resolve(tabs[0]));
  });
}

export async function checkTabCompatibility(): Promise<boolean> {
  const tab = await getActiveTab();
  if (!tab?.id || !tab.url) {
    return false;
  }
  const platform = detectPlatformFromUrl(tab.url);
  if (!(platform === 'chatgpt' || platform === 'gemini' || platform === 'claude')) {
    return false;
  }
  try {
    return (await sendToTab(tab.id, 'COMPAT_CHECK', undefined)).ready;
  } catch {
    return false;
  }
}

export async function sendPromptToTab(promptContent: string, attachments: AttachmentRef[] = []): Promise<void> {
  const tab = await getActiveTab();
  if (!tab?.id || !tab.url) {
    throw new Error('Open ChatGPT, Gemini, or Claude first.');
  }
  const platform = detectPlatformFromUrl(tab.url);
  if (!(platform === 'chatgpt' || platform === 'gemini' || platform === 'claude')) {
    throw new Error('Open ChatGPT, Gemini, or Claude first.');
  }
  try {
    const result = await sendToTab(tab.id, 'INJECT_PROMPT', { content: promptContent, attachments, expectedHref: tab.url });
    if (!result.ok) {
      throw new Error(result.reason || 'Couldn\'t insert the prompt.');
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Couldn\'t insert the prompt.';
    throw new Error(message);
  }
}

export async function insertAndSendPromptToTab(content: string, attachments: AttachmentRef[] = []): Promise<void> {
  const tab = await getActiveTab();
  if (!tab?.id || !tab.url) {
    throw new Error('Open ChatGPT, Gemini, or Claude first.');
  }
  const platform = detectPlatformFromUrl(tab.url);
  if (!(platform === 'chatgpt' || platform === 'gemini' || platform === 'claude')) {
    throw new Error('Open ChatGPT, Gemini, or Claude first.');
  }
  let result: InsertPromptResult;
  try {
    result = await sendToTab(tab.id, 'INSERT_AND_SEND_PROMPT', { content, attachments, expectedHref: tab.url });
  } catch {
    throw new Error('Your prompt may have been sent. Check the chat before you try again.');
  }
  if (!result.ok) {
    throw new Error(result.sendAttempted ? 'Your prompt may have been sent. Check the chat before you try again.' : result.reason || 'Couldn\'t send the prompt.');
  }
}

export function detectPlatformFromUrl(url: string): Platform {
  if (/^https?:\/\/chatgpt\.com\//.test(url) || /^https?:\/\/chat\.openai\.com\//.test(url)) {
    return 'chatgpt';
  }
  if (/^https?:\/\/gemini\.google\.com\//.test(url)) {
    return 'gemini';
  }
  if (/^https?:\/\/claude\.ai\//.test(url)) {
    return 'claude';
  }
  return 'other';
}

export async function detectActivePlatform(): Promise<Platform> {
  const tab = await getActiveTab();
  if (!tab?.url) {
    return 'other';
  }
  return detectPlatformFromUrl(tab.url);
}

export async function runChainOnTab(steps: ChainStep[], insertionModeOverride?: 'overwrite' | 'append'): Promise<void> {
  if (!Array.isArray(steps) || steps.length === 0) {
    throw new Error('No steps provided');
  }
  const tab = await getActiveTab();
  if (!tab?.id || !tab.url) {
    throw new Error('Open ChatGPT, Gemini, or Claude first.');
  }
  const platform = detectPlatformFromUrl(tab.url);
  if (!(platform === 'chatgpt' || platform === 'gemini' || platform === 'claude')) {
    throw new Error('Open ChatGPT, Gemini, or Claude first.');
  }

  // Best-effort readiness check; proceed even if false, as content scripts may attach shortly after
  try {
    const compat = await sendToTab(tab.id, 'COMPAT_CHECK', undefined);
    if (!compat.ready) {
      // continue; do not block chain start on this
    }
  } catch {
    // ignore errors; still attempt to start chain
  }

  try {
    const result = await sendToTab(tab.id, 'RUN_CHAIN', { steps, expectedHref: tab.url, insertionModeOverride });
    if (!result.ok) {
      throw new Error(result.reason === 'CONVERSATION_REQUIRED'
      ? 'Send a message to start the chat, then run the chain.'
      : result.reason === 'SETTINGS_UNAVAILABLE'
        ? 'LangQueue couldn\'t load on that page. Try again, or reload it.'
        : result.reason === 'COMPOSER_CHANGED'
          ? 'Your draft changed. Run the chain again.'
          : result.reason === 'CONVERSATION_CHANGED'
            ? 'You switched chats. Open the one you want and run the chain again.'
            : result.reason === 'CANCELLED'
              ? 'Chain cancelled.'
              : result.reason === 'COMPOSER_BUSY'
                ? 'Finish or cancel the queue first.'
                : 'Couldn\'t start the chain.');
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Couldn\'t start the chain.';
    throw new Error(message);
  }
}

export async function cancelChainOnTab(): Promise<void> {
  const tab = await getActiveTab();
  if (!tab?.id) {
    return;
  }
  try {
    await sendToTab(tab.id, 'CANCEL_CHAIN', undefined);
  } catch {
    // swallow errors; cancellation is best-effort
  }
}
