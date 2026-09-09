import type { AppSettings, AttachmentRef, Platform } from '../../types'
import type {
  PromptData,
  ChainData,
  AttachmentGetChunkMessage,
  AttachmentGetChunkResultMessage,
  AttachmentGetMetaMessage,
  AttachmentGetMetaResultMessage,
  GetSettingsMessage,
  SettingsResultMessage,
  PromptSearchMessage,
  PromptSearchResultMessage,
  ChainSearchMessage,
  ChainSearchResultMessage,
  LogUsageMessage,
  LogUsageResultMessage,
  OpenPromptEditorMessage,
  PromptUpdateMessage,
  PromptUpdateResultMessage,
  PromptDeleteMessage,
  PromptDeleteResultMessage,
  PromptCreateMessage,
  PromptCreateResultMessage,
} from '../../types/messages'

export async function getSettings(): Promise<AppSettings> {
  const response = (await chrome.runtime.sendMessage({ type: 'GET_SETTINGS' } as GetSettingsMessage)) as SettingsResultMessage | undefined
  if (response?.type !== 'SETTINGS_RESULT') throw new Error('Settings response is missing. Reload the extension and try again.')
  if (!response.payload?.ok) throw new Error(response.payload?.error || 'Settings could not be loaded.')
  return response.payload.settings
}

export async function searchPrompts(query: string, limit?: number): Promise<PromptData[]> {
  const payload: { query: string; limit?: number } = { query }
  if (typeof limit === 'number') payload.limit = limit
  const response = (await chrome.runtime.sendMessage({ type: 'PROMPT_SEARCH', payload } as PromptSearchMessage)) as PromptSearchResultMessage | undefined
  if (response?.type !== 'PROMPT_SEARCH_RESULT') throw new Error('Prompt search response is missing. Reload the extension and try again.')
  if (!response.payload?.ok) throw new Error(response.payload?.error || 'Prompt search failed.')
  return response.payload.prompts
}

export async function searchChains(query: string, limit?: number): Promise<ChainData[]> {
  const payload: { query: string; limit?: number } = { query }
  if (typeof limit === 'number') payload.limit = limit
  const response = (await chrome.runtime.sendMessage({ type: 'CHAIN_SEARCH', payload } as ChainSearchMessage)) as ChainSearchResultMessage | undefined
  if (response?.type !== 'CHAIN_SEARCH_RESULT') throw new Error('Chain search response is missing. Reload the extension and try again.')
  if (!response.payload?.ok) throw new Error(response.payload?.error || 'Chain search failed.')
  return response.payload.chains
}

export async function logUsage(promptId: string, platform: Platform) {
  try {
    const response = (await chrome.runtime.sendMessage({
      type: 'LOG_USAGE',
      payload: { promptId, platform },
    } as LogUsageMessage)) as LogUsageResultMessage | undefined
    if (response?.type !== 'LOG_USAGE_RESULT') throw new Error('Usage response is missing.')
    if (!response.payload.ok) throw new Error(response.payload.error || 'Usage could not be saved.')
  } catch (error) {
    // Report logging failure without retrying the prompt
    throw new Error(error instanceof Error ? error.message : 'Usage could not be saved.')
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

export async function updatePrompt(id: string, title: string, content: string, attachments?: AttachmentRef[]): Promise<boolean> {
  try {
    const response = (await chrome.runtime.sendMessage({
      type: 'PROMPT_UPDATE',
      payload: { id, title, content, ...(attachments ? { attachments } : {}) },
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

export async function createPrompt(title: string, content: string, attachments?: AttachmentRef[]): Promise<boolean> {
  try {
    const response = (await chrome.runtime.sendMessage({
      type: 'PROMPT_CREATE',
      payload: { title, content, ...(attachments ? { attachments } : {}) },
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

export async function getAttachmentMetas(ids: string[]): Promise<{ attachments: AttachmentRef[]; missingIds: string[] }> {
  if (!Array.isArray(ids) || ids.length === 0) return { attachments: [], missingIds: [] }
  try {
    const response = (await chrome.runtime.sendMessage({
      type: 'ATTACHMENT_GET_META',
      payload: { ids },
    } as AttachmentGetMetaMessage)) as AttachmentGetMetaResultMessage | undefined
    if (!response || response.type !== 'ATTACHMENT_GET_META_RESULT' || !response.payload.ok) {
      return { attachments: [], missingIds: ids }
    }
    return {
      attachments: response.payload.attachments || [],
      missingIds: response.payload.missingIds || [],
    }
  } catch {
    return { attachments: [], missingIds: ids }
  }
}

async function getAttachmentChunk(
  id: string,
  offset: number,
  length: number
): Promise<AttachmentGetChunkResultMessage['payload']> {
  const response = (await chrome.runtime.sendMessage({
    type: 'ATTACHMENT_GET_CHUNK',
    payload: { id, offset, length },
  } as AttachmentGetChunkMessage)) as AttachmentGetChunkResultMessage | undefined
  if (!response || response.type !== 'ATTACHMENT_GET_CHUNK_RESULT') {
    return {
      ok: false,
      id,
      offset,
      nextOffset: offset,
      totalBytes: 0,
      chunkBase64: '',
      done: true,
      error: 'INVALID_ATTACHMENT_CHUNK_RESPONSE',
    }
  }
  return response.payload
}

export async function fetchAttachmentFiles(attachments: AttachmentRef[]): Promise<File[]> {
  if (!Array.isArray(attachments) || attachments.length === 0) return []
  const files: File[] = []
  for (const attachment of attachments) {
    let offset = 0
    const chunks: string[] = []
    let totalBytes = 0
    let done = false
    while (!done) {
      const payload = await getAttachmentChunk(attachment.id, offset, 64 * 1024)
      if (!payload.ok) throw new Error(payload.error || 'ATTACHMENT_CHUNK_FAILED')
      chunks.push(payload.chunkBase64)
      offset = payload.nextOffset
      totalBytes = payload.totalBytes
      done = payload.done
    }
    const bytes = decodeBase64Chunks(chunks, totalBytes)
    files.push(new File([bytes], attachment.name, { type: attachment.mimeType }))
  }
  return files
}

function decodeBase64Chunks(chunks: string[], totalBytes: number): ArrayBuffer {
  const out = new Uint8Array(Math.max(0, totalBytes))
  let cursor = 0
  for (const chunk of chunks) {
    if (!chunk) continue
    const binary = atob(chunk)
    for (let i = 0; i < binary.length; i += 1) {
      if (cursor >= out.length) break
      out[cursor] = binary.charCodeAt(i)
      cursor += 1
    }
  }
  return out.buffer.slice(0, cursor)
}
