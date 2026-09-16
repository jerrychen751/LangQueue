import type { ChainStep, InsertPromptResult } from '../messaging/protocol'
import type { AttachmentRef, Platform } from '../library/model'
import { sendToTab } from '../messaging/transport'

function getActiveTab(): Promise<chrome.tabs.Tab | undefined> {
  return new Promise((resolve) => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => resolve(tabs[0]))
  })
}

export async function checkTabCompatibility(): Promise<boolean> {
  const tab = await getActiveTab()
  if (!tab?.id || !tab.url) return false
  const platform = detectPlatformFromUrl(tab.url)
  if (!(platform === 'chatgpt' || platform === 'gemini' || platform === 'claude')) return false
  try {
    return (await sendToTab(tab.id, 'COMPAT_CHECK', undefined)).ready
  } catch {
    return false
  }
}

export async function sendPromptToTab(promptContent: string, attachments: AttachmentRef[] = []): Promise<void> {
  const tab = await getActiveTab()
  if (!tab?.id || !tab.url) throw new Error('No active tab')
  const platform = detectPlatformFromUrl(tab.url)
  if (!(platform === 'chatgpt' || platform === 'gemini' || platform === 'claude')) throw new Error('Not on a compatible AI chat page')
  try {
    const result = await sendToTab(tab.id, 'INJECT_PROMPT', { content: promptContent, attachments, expectedHref: tab.url })
    if (!result.ok) throw new Error(result.reason || 'Failed to inject prompt')
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Injection failed'
    throw new Error(message)
  }
}

export async function insertAndSendPromptToTab(content: string, attachments: AttachmentRef[] = []): Promise<void> {
  const tab = await getActiveTab()
  if (!tab?.id || !tab.url) throw new Error('No active tab')
  const platform = detectPlatformFromUrl(tab.url)
  if (!(platform === 'chatgpt' || platform === 'gemini' || platform === 'claude')) throw new Error('Not on a compatible AI chat page')
  let result: InsertPromptResult
  try {
    result = await sendToTab(tab.id, 'INSERT_AND_SEND_PROMPT', { content, attachments, expectedHref: tab.url })
  } catch {
    throw new Error('Sending could not be confirmed. Check the original conversation before trying again; the prompt may have been sent.')
  }
  if (!result.ok) throw new Error((result.reason || 'Sending failed.') + (result.sendAttempted ? ' The prompt may have been sent. Check the conversation before trying again.' : ''))
}

export function detectPlatformFromUrl(url: string): Platform {
  if (/^https?:\/\/chatgpt\.com\//.test(url) || /^https?:\/\/chat\.openai\.com\//.test(url)) return 'chatgpt'
  if (/^https?:\/\/gemini\.google\.com\//.test(url)) return 'gemini'
  if (/^https?:\/\/claude\.ai\//.test(url)) return 'claude'
  return 'other'
}

export async function detectActivePlatform(): Promise<Platform> {
  const tab = await getActiveTab()
  if (!tab?.url) return 'other'
  return detectPlatformFromUrl(tab.url)
}

export async function runChainOnTab(steps: ChainStep[], insertionModeOverride?: 'overwrite' | 'append'): Promise<void> {
  if (!Array.isArray(steps) || steps.length === 0) throw new Error('No steps provided')
  const tab = await getActiveTab()
  if (!tab?.id || !tab.url) throw new Error('No active tab')
  const platform = detectPlatformFromUrl(tab.url)
  if (!(platform === 'chatgpt' || platform === 'gemini' || platform === 'claude')) throw new Error('Not on a compatible AI chat page')

  // Best-effort readiness check; proceed even if false, as content scripts may attach shortly after
  try {
    const compat = await sendToTab(tab.id, 'COMPAT_CHECK', undefined)
    if (!compat.ready) {
      // continue; do not block chain start on this
    }
  } catch {
    // ignore errors; still attempt to start chain
  }

  try {
    const result = await sendToTab(tab.id, 'RUN_CHAIN', { steps, expectedHref: tab.url, insertionModeOverride })
    if (!result.ok) throw new Error(result.reason === 'CONVERSATION_REQUIRED'
      ? 'Start a conversation first, then run the chain. Your draft was kept.'
      : result.reason === 'SETTINGS_UNAVAILABLE'
        ? 'Settings are unavailable. Try the action again to reload settings; if it still fails, reload the extension.'
        : result.reason === 'COMPOSER_CHANGED'
          ? 'The draft changed while settings loaded. Start the chain again when ready.'
          : result.reason === 'CONVERSATION_CHANGED'
            ? 'The conversation changed before the chain started. Return to the intended conversation and try again.'
            : result.reason === 'CANCELLED'
              ? 'The chain was cancelled before it started. Your draft was kept.'
              : result.reason || 'Failed to start chain')
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to start chain'
    throw new Error(message)
  }
}

export async function cancelChainOnTab(): Promise<void> {
  const tab = await getActiveTab()
  if (!tab?.id) return
  try {
    await sendToTab(tab.id, 'CANCEL_CHAIN', undefined)
  } catch {
    // swallow errors; cancellation is best-effort
  }
}
