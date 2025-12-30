/// <reference lib="webworker" />

import { getSettings, searchPrompts, searchChains, logUsage, updatePrompt, deletePrompt, savePrompt } from '../utils/storage'
import type { Platform, PromptSummary, ChainSummary } from '../types'

const PLATFORM_VALUES = [
  'chatgpt',
  'claude',
  'gemini',
  'perplexity',
  'bing',
  'poe',
  'huggingchat',
  'other',
] as const

function normalizePlatform(value: unknown): Platform {
  return typeof value === 'string' && PLATFORM_VALUES.includes(value as Platform)
    ? (value as Platform)
    : 'other'
}

function makeLImage(size: number): ImageData | null {
  // Generate a simple white "L" on a dark background for the action icon.
  // Use OffscreenCanvas since we're in a service worker context.
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore - feature detection
  if (typeof OffscreenCanvas === 'undefined') return null

  const canvas = new OffscreenCanvas(size, size)
  const ctx = canvas.getContext('2d')
  if (!ctx) return null

  // Dark background (softer slate gradient)
  const gradient = ctx.createLinearGradient(0, 0, 0, size)
  gradient.addColorStop(0, '#0f172a')
  gradient.addColorStop(1, '#1f2937')
  ctx.fillStyle = gradient
  ctx.fillRect(0, 0, size, size)

  // Subtle border for definition
  ctx.strokeStyle = 'rgba(255,255,255,0.06)'
  ctx.lineWidth = Math.max(1, Math.floor(size * 0.05))
  ctx.strokeRect(ctx.lineWidth / 2, ctx.lineWidth / 2, size - ctx.lineWidth, size - ctx.lineWidth)

  // Draw a rounded-stroke "L" path and center it exactly
  const strokeWidth = Math.max(2, Math.floor(size * 0.16))
  const glyphHeight = Math.floor(size * 0.50)
  const horizontalLength = Math.floor(size * 0.40)

  // Bounding box of the stroked path with round caps: width = L + W, height = H + W
  const bboxWidth = horizontalLength + strokeWidth
  const bboxHeight = glyphHeight + strokeWidth
  const originX = Math.floor((size - bboxWidth) / 2 + strokeWidth / 2)
  const originY = Math.floor((size - bboxHeight) / 2 + strokeWidth / 2)

  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  ctx.lineWidth = strokeWidth
  ctx.strokeStyle = '#e5e7eb' // softer light gray instead of pure white
  ctx.shadowColor = 'rgba(0,0,0,0.18)'
  ctx.shadowBlur = Math.max(0, Math.floor(size * 0.06))

  ctx.beginPath()
  ctx.moveTo(originX, originY)
  ctx.lineTo(originX, originY + glyphHeight)
  ctx.lineTo(originX + horizontalLength, originY + glyphHeight)
  ctx.stroke()

  return ctx.getImageData(0, 0, size, size)
}

function generatePromptId(): string {
  return `p_${Date.now()}_${Math.random().toString(36).slice(2)}`
}

function setLActionIcon(): void {
  const sizes = [16, 32, 48, 128] as const
  const imageData: Record<string, ImageData> = {}
  for (const s of sizes) {
    const img = makeLImage(s)
    if (img) imageData[String(s)] = img
  }
  try {
    const maybe = chrome.action.setIcon({ imageData })
    if (maybe && typeof (maybe as Promise<void>).then === 'function') {
      ;(maybe as Promise<void>).catch(() => {})
    }
  } catch {
    // swallow
  }
}

chrome.runtime.onInstalled.addListener(() => {
  setLActionIcon()
  // Placeholder for first-run logic
})

chrome.runtime.onStartup.addListener(() => {
  setLActionIcon()
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
  if (message?.type === 'GET_SETTINGS') {
    getSettings('local')
      .then((settings) => sendResponse({ type: 'SETTINGS_RESULT', payload: { settings } }))
      .catch(() => sendResponse({ type: 'SETTINGS_RESULT', payload: { settings: {} } }))
    return true
  }
  if (message?.type === 'PROMPT_SEARCH') {
    const query = typeof message?.payload?.query === 'string' ? message.payload.query : ''
    const limit = typeof message?.payload?.limit === 'number' ? message.payload.limit : null
    searchPrompts(query, 'local')
      .then((results) => {
        const trimmed = typeof limit === 'number' ? results.slice(0, Math.max(0, limit)) : results
        const prompts: PromptSummary[] = trimmed.map((p) => ({
          id: p.id,
          title: p.title,
          content: p.content,
        }))
        sendResponse({ type: 'PROMPT_SEARCH_RESULT', payload: { prompts } })
      })
      .catch(() => sendResponse({ type: 'PROMPT_SEARCH_RESULT', payload: { prompts: [] } }))
    return true
  }
  if (message?.type === 'CHAIN_SEARCH') {
    const query = typeof message?.payload?.query === 'string' ? message.payload.query : ''
    const limit = typeof message?.payload?.limit === 'number' ? message.payload.limit : null
    searchChains(query, 'local')
      .then((results) => {
        const trimmed = typeof limit === 'number' ? results.slice(0, Math.max(0, limit)) : results
        const chains: ChainSummary[] = trimmed.map((c) => ({
          id: c.id,
          title: c.title,
          steps: c.steps,
        }))
        sendResponse({ type: 'CHAIN_SEARCH_RESULT', payload: { chains } })
      })
      .catch(() => sendResponse({ type: 'CHAIN_SEARCH_RESULT', payload: { chains: [] } }))
    return true
  }
  if (message?.type === 'PROMPT_UPDATE') {
    const id = message?.payload?.id
    const title = message?.payload?.title
    const content = message?.payload?.content
    if (typeof id !== 'string' || typeof title !== 'string' || typeof content !== 'string') {
      sendResponse({ type: 'PROMPT_UPDATE_RESULT', payload: { ok: false, error: 'INVALID_PAYLOAD' } })
      return
    }
    updatePrompt(id, { title, content }, 'local')
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
    deletePrompt(id, 'local')
      .then(() => sendResponse({ type: 'PROMPT_DELETE_RESULT', payload: { ok: true } }))
      .catch((err) => {
        sendResponse({ type: 'PROMPT_DELETE_RESULT', payload: { ok: false, error: err?.message || 'DELETE_FAILED' } })
      })
    return true
  }
  if (message?.type === 'PROMPT_CREATE') {
    const title = message?.payload?.title
    const content = message?.payload?.content
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
        usageCount: 0,
        createdAt: now,
        updatedAt: now,
      },
      'local'
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
      void logUsage({ timestamp: Date.now(), platform, promptId }, 'local').finally(() => {
        sendResponse({ ok: true })
      })
      return true
    }
    sendResponse({ ok: false })
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
})
