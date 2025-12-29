import type { AppSettings, Platform, PromptSummary } from '../../types'
import type {
  GetSettingsMessage,
  SettingsResultMessage,
  PromptSearchMessage,
  PromptSearchResultMessage,
  LogUsageMessage,
  OpenPromptEditorMessage,
  PromptUpdateMessage,
  PromptUpdateResultMessage,
  PromptDeleteMessage,
  PromptDeleteResultMessage,
  PromptCreateMessage,
  PromptCreateResultMessage,
} from '../../types/messages'

export async function getSettings(): Promise<AppSettings> {
  try {
    const response = (await chrome.runtime.sendMessage({ type: 'GET_SETTINGS' } as GetSettingsMessage)) as SettingsResultMessage | undefined
    return response?.type === 'SETTINGS_RESULT' ? response.payload.settings : {}
  } catch {
    return {}
  }
}

export async function searchPrompts(query: string, limit?: number): Promise<PromptSummary[]> {
  try {
    const payload: { query: string; limit?: number } = { query }
    if (typeof limit === 'number') {
      payload.limit = limit
    }
    const response = (await chrome.runtime.sendMessage({
      type: 'PROMPT_SEARCH',
      payload,
    } as PromptSearchMessage)) as PromptSearchResultMessage | undefined
    return response?.type === 'PROMPT_SEARCH_RESULT' ? response.payload.prompts : []
  } catch {
    return []
  }
}

export async function logUsage(promptId: string, platform: Platform) {
  try {
    await chrome.runtime.sendMessage({
      type: 'LOG_USAGE',
      payload: { promptId, platform },
    } as LogUsageMessage)
  } catch {
    // best-effort logging
  }
}

export async function openPromptEditor(promptId: string) {
  try {
    await chrome.runtime.sendMessage({
      type: 'OPEN_PROMPT_EDITOR',
      payload: { promptId },
    } as OpenPromptEditorMessage)
  } catch {
    // no-op
  }
}

export async function updatePrompt(id: string, title: string, content: string): Promise<boolean> {
  try {
    const response = (await chrome.runtime.sendMessage({
      type: 'PROMPT_UPDATE',
      payload: { id, title, content },
    } as PromptUpdateMessage)) as PromptUpdateResultMessage | undefined
    if (response?.type !== 'PROMPT_UPDATE_RESULT') return false
    if (!response.payload.ok) {
      throw new Error(response.payload.error || 'Failed to save.')
    }
    return true
  } catch (err) {
    if (err instanceof Error) throw err
    throw new Error('Failed to save.')
  }
}

export async function deletePrompt(id: string): Promise<boolean> {
  try {
    const response = (await chrome.runtime.sendMessage({
      type: 'PROMPT_DELETE',
      payload: { id },
    } as PromptDeleteMessage)) as PromptDeleteResultMessage | undefined
    return response?.type === 'PROMPT_DELETE_RESULT' && response.payload.ok
  } catch {
    return false
  }
}

export async function createPrompt(title: string, content: string): Promise<boolean> {
  try {
    const response = (await chrome.runtime.sendMessage({
      type: 'PROMPT_CREATE',
      payload: { title, content },
    } as PromptCreateMessage)) as PromptCreateResultMessage | undefined
    if (response?.type !== 'PROMPT_CREATE_RESULT') return false
    if (!response.payload.ok) {
      throw new Error(response.payload.error || 'Failed to save.')
    }
    return true
  } catch (err) {
    if (err instanceof Error) throw err
    throw new Error('Failed to save.')
  }
}
