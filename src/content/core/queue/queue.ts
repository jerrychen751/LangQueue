import type { Adapter } from '../../adapters/adapter'
import { setInputText } from '../insert/composer'
import type { AttachmentRef } from '../../../types'
import { fetchAttachmentFiles } from '../messaging'

type InputElement = HTMLTextAreaElement | HTMLElement

export type QueueItem = {
  content: string
  attachments?: AttachmentRef[]
  promptId?: string
}

export function createQueue(adapter: Adapter, getInput: () => InputElement | null) {
  const items: QueueItem[] = []
  let running = false

  async function flush() {
    if (running) return
    running = true
    try {
      while (items.length > 0) {
        const idle = await adapter.waitForIdle()
        if (!idle) break
        const input = getInput() || adapter.getInputElement()
        if (!input) break
        const item = items[0]
        if (Array.isArray(item.attachments) && item.attachments.length > 0) {
          const files = await fetchAttachmentFiles(item.attachments)
          const attached = await adapter.attachFiles(files)
          if (!attached.ok) break
          const ready = await adapter.waitForUploadsComplete({ timeoutMs: 120000, pollMs: 250 })
          if (!ready) break
        }
        setInputText(input, item.content)
        const sent = adapter.clickSend(input as HTMLTextAreaElement)
        if (!sent) break
        await adapter.waitForIdle()
        items.shift()
      }
    } finally {
      running = false
    }
  }

  function enqueue(item: QueueItem) {
    items.push(item)
    void flush()
  }

  function size() {
    return items.length
  }

  return {
    enqueue,
    flush,
    size,
  }
}
