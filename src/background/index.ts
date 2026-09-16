/// <reference lib="webworker" />

import { getSettings, saveSettings, searchPrompts, searchChains, logUsage, updatePrompt, deletePrompt, savePrompt } from '../library/storage'
import { getAttachmentChunkBase64, getAttachmentMeta } from '../library/attachments'
import type { BackgroundRequests } from '../messaging/protocol'
import { listenForRequests, type RequestHandlers } from '../messaging/transport'

function generatePromptId(): string {
  return `p_${Date.now()}_${Math.random().toString(36).slice(2)}`
}

chrome.runtime.onInstalled.addListener((details) => {
  // First-run logic
  if (details.reason !== 'install') return
  chrome.tabs.create({ url: chrome.runtime.getURL('onboarding.html') }).catch(() => {})
})

const requestHandlers: RequestHandlers<BackgroundRequests> = {
  GET_SETTINGS: () => getSettings(),
  SAVE_SETTINGS: ({ settings }) => saveSettings(settings),
  PROMPT_SEARCH: async ({ query, limit }) => {
    const results = await searchPrompts(query)
    const trimmed = typeof limit === 'number' ? results.slice(0, Math.max(0, limit)) : results
    return trimmed.map((p) => ({
      id: p.id,
      title: p.title,
      content: p.content,
      attachments: p.attachments || [],
    }))
  },
  CHAIN_SEARCH: async ({ query, limit }) => {
    const results = await searchChains(query)
    const trimmed = typeof limit === 'number' ? results.slice(0, Math.max(0, limit)) : results
    return trimmed.map((c) => ({
      id: c.id,
      title: c.title,
      steps: c.steps,
    }))
  },
  PROMPT_CREATE: async ({ title, content, attachments = [] }) => {
    const now = Date.now()
    const id = generatePromptId()
    await savePrompt({
      id,
      title,
      content,
      attachments,
      usageCount: 0,
      createdAt: now,
      updatedAt: now,
    })
    return { id }
  },
  PROMPT_UPDATE: ({ id, title, content, attachments }) => updatePrompt(id, { title, content, ...(attachments ? { attachments } : {}) }),
  PROMPT_DELETE: ({ id }) => deletePrompt(id),
  LOG_USAGE: ({ promptId, platform }) => logUsage({ timestamp: Date.now(), platform, promptId }),
  OPEN_PROMPT_EDITOR: async ({ promptId }) => {
    await new Promise<void>((resolve) => {
      chrome.storage.local.set({ langqueue_pending_action: { type: 'OPEN_EDIT_PROMPT', promptId } }, () => resolve())
    })
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
  },
  ATTACHMENT_GET_META: async ({ ids }) => {
    const items = await Promise.all(ids.map((id) => getAttachmentMeta(id)))
    const attachments = items.filter((item): item is NonNullable<typeof item> => Boolean(item))
    const foundIds = new Set(attachments.map((item) => item.id))
    return { attachments, missingIds: ids.filter((id) => !foundIds.has(id)) }
  },
  ATTACHMENT_GET_CHUNK: async ({ id, offset, length }) => {
    const chunk = await getAttachmentChunkBase64(id, offset, length)
    if (!chunk) throw new Error('ATTACHMENT_NOT_FOUND')
    return chunk
  },
}

chrome.runtime.onMessage.addListener(listenForRequests<BackgroundRequests>(requestHandlers))
