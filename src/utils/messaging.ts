import type {
  CompatCheckMessage,
  CompatStatusMessage,
  InjectPromptMessage,
  InjectPromptResultMessage,
  RunChainMessage,
  CancelChainMessage,
  ChainStep,
} from '../types/messages'
import type { Platform } from '../types'

function getActiveTab(): Promise<chrome.tabs.Tab | undefined> {
  return new Promise((resolve) => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => resolve(tabs[0]))
  })
}

export async function checkTabCompatibility(): Promise<boolean> {
  const tab = await getActiveTab()
  if (!tab?.id || !tab.url) return false
  const platform = detectPlatformFromUrl(tab.url)
  if (!(platform === 'chatgpt' || platform === 'gemini')) return false
  try {
    const response = (await chrome.tabs.sendMessage(tab.id, { type: 'COMPAT_CHECK' } as CompatCheckMessage)) as
      | CompatStatusMessage
      | undefined
    return Boolean(response && response.type === 'COMPAT_STATUS' && response.payload?.ready)
  } catch {
    return false
  }
}

export async function sendPromptToTab(promptContent: string): Promise<void> {
  const tab = await getActiveTab()
  if (!tab?.id || !tab.url) throw new Error('No active tab')
  const platform = detectPlatformFromUrl(tab.url)
  if (!(platform === 'chatgpt' || platform === 'gemini')) throw new Error('Not on a compatible AI chat page')
  try {
    const res = (await chrome.tabs.sendMessage(tab.id, { type: 'INJECT_PROMPT', payload: { content: promptContent } } as InjectPromptMessage)) as
      | InjectPromptResultMessage
      | undefined
    if (!res || res.type !== 'INJECT_PROMPT_RESULT' || !res.payload.ok) {
      throw new Error('Failed to inject prompt')
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Injection failed'
    throw new Error(message)
  }
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
  if (!(platform === 'chatgpt' || platform === 'gemini')) throw new Error('Not on a compatible AI chat page')

  // Best-effort readiness check; proceed even if false, as content scripts may attach shortly after
  try {
    const compat = (await chrome.tabs.sendMessage(tab.id, { type: 'COMPAT_CHECK' } as CompatCheckMessage)) as CompatStatusMessage | undefined
    if (!compat || compat.type !== 'COMPAT_STATUS' || !compat.payload?.ready) {
      // continue; do not block chain start on this
    }
  } catch {
    // ignore errors; still attempt to start chain
  }

  const msg: RunChainMessage = { type: 'RUN_CHAIN', payload: { steps, insertionModeOverride } }
  try {
    await chrome.tabs.sendMessage(tab.id, msg)
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


