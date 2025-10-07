/// <reference lib="webworker" />

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
  }
})

chrome.commands.onCommand.addListener(async (command) => {
  try {
    if (command === 'open_popup') {
      try {
        await (chrome.action.openPopup?.() as Promise<void> | undefined)
      } catch {
        // swallow
      }
      return
    }
    if (command === 'enhance_prompt' || command === 'save_prompt' || command === 'create_prompt') {
      try {
        await new Promise<void>((resolve) => {
          chrome.storage.local.set({ langqueue_pending_action: 'OPEN_NEW_PROMPT' }, () => resolve())
        })
        await (chrome.action.openPopup?.() as Promise<void> | undefined)
      } catch {
        // swallow
      }
      // Give the popup a moment to mount, then request opening the builder
      setTimeout(() => {
        chrome.runtime.sendMessage({ type: 'OPEN_NEW_PROMPT' })
      }, 600)
      return
    }
    // No other commands
  } catch {
    // swallow
  }
})


