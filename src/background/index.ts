/// <reference lib="webworker" />

import { getSettings, saveSettings, searchPrompts, searchChains, logUsage, updatePrompt, deletePrompt, savePrompt } from '../utils/storage'
import { getAttachmentChunkBase64, getAttachmentMeta } from '../utils/attachments'
import type { Platform } from '../types'
import type { PromptData, ChainData } from '../types/messages'

const PLATFORM_VALUES = [
  'chatgpt',
  'claude',
  'gemini',
  'other',
] as const

function normalizePlatform(value: unknown): Platform {
  return typeof value === 'string' && PLATFORM_VALUES.includes(value as Platform)
    ? (value as Platform)
    : 'other'
}

function generatePromptId(): string {
  return `p_${Date.now()}_${Math.random().toString(36).slice(2)}`
}

chrome.runtime.onInstalled.addListener(() => {
  // Placeholder for first-run logic
})

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === 'PING') {
    sendResponse({ ok: true })
    return
  }
  if (message?.type === 'OPEN_POPUP') {
    // Avoid unhandled promise rejection if no active browser window
    try {
      const maybePromise = chrome.action.openPopup?.()
      if (maybePromise && typeof (maybePromise as Promise<void>).then === 'function') {
        ;(maybePromise as Promise<void>).catch(() => {})
      }
    } catch {
      // swallow
    }
    return
  }
  if (message?.type === 'SAVE_SETTINGS') {
    const settings = message.payload?.settings
    if (!settings || typeof settings !== 'object' || Array.isArray(settings)) {
      sendResponse({ type: 'SAVE_SETTINGS_RESULT', payload: { ok: false, error: 'Invalid settings payload' } })
      return
    }
    saveSettings(settings)
      .then(() => sendResponse({ type: 'SAVE_SETTINGS_RESULT', payload: { ok: true } }))
      .catch((error) => sendResponse({ type: 'SAVE_SETTINGS_RESULT', payload: { ok: false, error: error instanceof Error ? error.message : 'Settings save failed' } }))
    return true
  }
  if (message?.type === 'GET_SETTINGS') {
    getSettings()
      .then((settings) => sendResponse({ type: 'SETTINGS_RESULT', payload: { ok: true, settings } }))
      .catch((error) => sendResponse({ type: 'SETTINGS_RESULT', payload: { ok: false, error: error instanceof Error ? error.message : 'Settings could not be loaded' } }))
    return true
  }
  if (message?.type === 'PROMPT_SEARCH') {
    const query = typeof message?.payload?.query === 'string' ? message.payload.query : ''
    const limit = typeof message?.payload?.limit === 'number' ? message.payload.limit : null
    searchPrompts(query)
      .then((results) => {
        const trimmed = typeof limit === 'number' ? results.slice(0, Math.max(0, limit)) : results
        const prompts: PromptData[] = trimmed.map((p) => ({
          id: p.id,
          title: p.title,
          content: p.content,
          attachments: p.attachments || [],
        }))
        sendResponse({ type: 'PROMPT_SEARCH_RESULT', payload: { ok: true, prompts } })
      })
      .catch((error) => sendResponse({ type: 'PROMPT_SEARCH_RESULT', payload: { ok: false, error: error instanceof Error ? error.message : 'Prompt search failed' } }))
    return true
  }
  if (message?.type === 'CHAIN_SEARCH') {
    const query = typeof message?.payload?.query === 'string' ? message.payload.query : ''
    const limit = typeof message?.payload?.limit === 'number' ? message.payload.limit : null
    searchChains(query)
      .then((results) => {
        const trimmed = typeof limit === 'number' ? results.slice(0, Math.max(0, limit)) : results
        const chains: ChainData[] = trimmed.map((c) => ({
          id: c.id,
          title: c.title,
          steps: c.steps,
        }))
        sendResponse({ type: 'CHAIN_SEARCH_RESULT', payload: { ok: true, chains } })
      })
      .catch((error) => sendResponse({ type: 'CHAIN_SEARCH_RESULT', payload: { ok: false, error: error instanceof Error ? error.message : 'Chain search failed' } }))
    return true
  }
  if (message?.type === 'PROMPT_UPDATE') {
    const id = message?.payload?.id
    const title = message?.payload?.title
    const content = message?.payload?.content
    const attachments = Array.isArray(message?.payload?.attachments) ? message.payload.attachments : undefined
    if (typeof id !== 'string' || typeof title !== 'string' || typeof content !== 'string') {
      sendResponse({ type: 'PROMPT_UPDATE_RESULT', payload: { ok: false, error: 'INVALID_PAYLOAD' } })
      return
    }
    updatePrompt(id, { title, content, ...(attachments ? { attachments } : {}) })
      .then(() => sendResponse({ type: 'PROMPT_UPDATE_RESULT', payload: { ok: true } }))
      .catch((err) => {
        sendResponse({ type: 'PROMPT_UPDATE_RESULT', payload: { ok: false, error: err?.message || 'UPDATE_FAILED' } })
      })
    return true
  }
  if (message?.type === 'PROMPT_DELETE') {
    const id = message?.payload?.id
    if (typeof id !== 'string') {
      sendResponse({ type: 'PROMPT_DELETE_RESULT', payload: { ok: false, error: 'INVALID_PAYLOAD' } })
      return
    }
    deletePrompt(id)
      .then(() => sendResponse({ type: 'PROMPT_DELETE_RESULT', payload: { ok: true } }))
      .catch((err) => {
        sendResponse({ type: 'PROMPT_DELETE_RESULT', payload: { ok: false, error: err?.message || 'DELETE_FAILED' } })
      })
    return true
  }
  if (message?.type === 'PROMPT_CREATE') {
    const title = message?.payload?.title
    const content = message?.payload?.content
    const attachments = Array.isArray(message?.payload?.attachments) ? message.payload.attachments : []
    if (typeof title !== 'string' || typeof content !== 'string') {
      sendResponse({ type: 'PROMPT_CREATE_RESULT', payload: { ok: false, error: 'INVALID_PAYLOAD' } })
      return
    }
    const now = Date.now()
    const id = generatePromptId()
    savePrompt(
      {
        id,
        title,
        content,
        attachments,
        usageCount: 0,
        createdAt: now,
        updatedAt: now,
      }
    )
      .then(() => sendResponse({ type: 'PROMPT_CREATE_RESULT', payload: { ok: true, id } }))
      .catch((err) => {
        sendResponse({ type: 'PROMPT_CREATE_RESULT', payload: { ok: false, error: err?.message || 'CREATE_FAILED' } })
      })
    return true
  }
  if (message?.type === 'LOG_USAGE') {
    const promptId = message?.payload?.promptId
    const platform = normalizePlatform(message?.payload?.platform)
    if (typeof promptId === 'string') {
      void logUsage({ timestamp: Date.now(), platform, promptId })
        .then(() => sendResponse({ type: 'LOG_USAGE_RESULT', payload: { ok: true } }))
        .catch((error) => sendResponse({ type: 'LOG_USAGE_RESULT', payload: { ok: false, error: error instanceof Error ? error.message : 'Usage could not be saved' } }))
      return true
    }
    sendResponse({ type: 'LOG_USAGE_RESULT', payload: { ok: false, error: 'Invalid prompt ID' } })
    return
  }
  if (message?.type === 'OPEN_PROMPT_EDITOR') {
    const promptId = message?.payload?.promptId
    if (!promptId || typeof promptId !== 'string') {
      sendResponse({ ok: false })
      return
    }
    void new Promise<void>((resolve) => {
      chrome.storage.local.set({ langqueue_pending_action: { type: 'OPEN_EDIT_PROMPT', promptId } }, () => resolve())
    }).finally(() => {
      try {
        const maybePromise = chrome.action.openPopup?.()
        if (maybePromise && typeof (maybePromise as Promise<void>).then === 'function') {
          ;(maybePromise as Promise<void>).catch(() => {})
        }
      } catch {
        // swallow
      }
      setTimeout(() => {
        chrome.runtime.sendMessage({ type: 'OPEN_EDIT_PROMPT', payload: { promptId } })
      }, 600)
      sendResponse({ ok: true })
    })
    return true
  }
  if (message?.type === 'ATTACHMENT_GET_META') {
    const ids = Array.isArray(message?.payload?.ids) ? message.payload.ids.filter((id: unknown) => typeof id === 'string') : []
    Promise.all(ids.map((id: string) => getAttachmentMeta(id)))
      .then((items) => {
        const attachments = items.filter((item): item is NonNullable<typeof item> => Boolean(item))
        const foundIds = new Set(attachments.map((item) => item.id))
        const missingIds = ids.filter((id: string) => !foundIds.has(id))
        sendResponse({
          type: 'ATTACHMENT_GET_META_RESULT',
          payload: { ok: true, attachments, missingIds },
        })
      })
      .catch((err) => {
        sendResponse({
          type: 'ATTACHMENT_GET_META_RESULT',
          payload: { ok: false, attachments: [], missingIds: ids, error: err?.message || 'ATTACHMENT_META_FAILED' },
        })
      })
    return true
  }
  if (message?.type === 'ATTACHMENT_GET_CHUNK') {
    const id = message?.payload?.id
    const offset = message?.payload?.offset
    const length = message?.payload?.length
    if (typeof id !== 'string' || typeof offset !== 'number' || typeof length !== 'number') {
      sendResponse({
        type: 'ATTACHMENT_GET_CHUNK_RESULT',
        payload: { ok: false, id: String(id || ''), offset: 0, nextOffset: 0, totalBytes: 0, chunkBase64: '', done: true, error: 'INVALID_PAYLOAD' },
      })
      return
    }
    getAttachmentChunkBase64(id, offset, length)
      .then((chunk) => {
        if (!chunk) {
          sendResponse({
            type: 'ATTACHMENT_GET_CHUNK_RESULT',
            payload: { ok: false, id, offset, nextOffset: offset, totalBytes: 0, chunkBase64: '', done: true, error: 'ATTACHMENT_NOT_FOUND' },
          })
          return
        }
        sendResponse({
          type: 'ATTACHMENT_GET_CHUNK_RESULT',
          payload: {
            ok: true,
            id,
            offset,
            nextOffset: chunk.nextOffset,
            totalBytes: chunk.totalBytes,
            chunkBase64: chunk.chunkBase64,
            done: chunk.done,
          },
        })
      })
      .catch((err) => {
        sendResponse({
          type: 'ATTACHMENT_GET_CHUNK_RESULT',
          payload: { ok: false, id, offset, nextOffset: offset, totalBytes: 0, chunkBase64: '', done: true, error: err?.message || 'ATTACHMENT_CHUNK_FAILED' },
        })
      })
    return true
  }
})
