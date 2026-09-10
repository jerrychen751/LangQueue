import type {
  CompatCheckMessage,
  CompatStatusMessage,
  InjectPromptMessage,
  InjectPromptResultMessage,
  RunChainMessage,
  CancelChainMessage,
  ChainStep,
  InsertAndSendPromptMessage,
  InsertAndSendPromptResultMessage,
} from '../types/messages'
import type { AttachmentRef, Platform } from '../types'

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
    const response = (await chrome.tabs.sendMessage(tab.id, { type: 'COMPAT_CHECK' } as CompatCheckMessage)) as
      | CompatStatusMessage
      | undefined
    return Boolean(response && response.type === 'COMPAT_STATUS' && response.payload?.ready)
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
    const res = (await chrome.tabs.sendMessage(tab.id, {
      type: 'INJECT_PROMPT',
      payload: { content: promptContent, attachments, expectedHref: tab.url },
    } as InjectPromptMessage)) as
      | InjectPromptResultMessage
      | undefined
    if (!res || res.type !== 'INJECT_PROMPT_RESULT' || !res.payload.ok) {
      throw new Error(res?.payload?.reason || 'Failed to inject prompt')
    }
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
  let response: InsertAndSendPromptResultMessage | undefined
  try {
    response = await chrome.tabs.sendMessage(tab.id, {
      type: 'INSERT_AND_SEND_PROMPT',
      payload: { content, attachments, expectedHref: tab.url },
    } as InsertAndSendPromptMessage)
  } catch {
    throw new Error('Sending could not be confirmed. Check the original conversation before trying again; the prompt may have been sent.')
  }
  if (!response || response.type !== 'INSERT_AND_SEND_PROMPT_RESULT') throw new Error('Sending could not be confirmed. Check the original conversation before trying again.')
  if (!response.payload.ok) throw new Error((response.payload.reason || 'Sending failed.') + (response.payload.sendAttempted ? ' The prompt may have been sent. Check the conversation before trying again.' : ''))
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
    const compat = (await chrome.tabs.sendMessage(tab.id, { type: 'COMPAT_CHECK' } as CompatCheckMessage)) as CompatStatusMessage | undefined
    if (!compat || compat.type !== 'COMPAT_STATUS' || !compat.payload?.ready) {
      // continue; do not block chain start on this
    }
  } catch {
    // ignore errors; still attempt to start chain
  }

  const msg: RunChainMessage = { type: 'RUN_CHAIN', payload: { steps, expectedHref: tab.url, insertionModeOverride } }
  try {
    const response = await chrome.tabs.sendMessage(tab.id, msg)
    if (!response?.ok) throw new Error(response?.reason === 'CONVERSATION_REQUIRED'
      ? 'Start a conversation first, then run the chain. Your draft was kept.'
      : response?.reason === 'SETTINGS_UNAVAILABLE'
        ? 'Settings are unavailable. Try the action again to reload settings; if it still fails, reload the extension.'
        : response?.reason === 'COMPOSER_CHANGED'
          ? 'The draft changed while settings loaded. Start the chain again when ready.'
          : response?.reason === 'CONVERSATION_CHANGED'
            ? 'The conversation changed before the chain started. Return to the intended conversation and try again.'
            : response?.reason === 'CANCELLED'
              ? 'The chain was cancelled before it started. Your draft was kept.'
              : response?.reason || 'Failed to start chain')
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to start chain'
    throw new Error(message)
  }
}

export async function cancelChainOnTab(): Promise<void> {
  const tab = await getActiveTab()
  if (!tab?.id) return
  const msg: CancelChainMessage = { type: 'CANCEL_CHAIN' }
  try {
    await chrome.tabs.sendMessage(tab.id, msg)
  } catch {
    // swallow errors; cancellation is best-effort
  }
}

