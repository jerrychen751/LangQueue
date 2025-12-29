import type { Adapter, InputElement } from '../types'
import { setInputText } from '../insert/composer'

export type QueueItem = {
  content: string
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
        const input = getInput() || adapter.findInput()
        if (!input) break
        const item = items[0]
        setInputText(input, item.content)
        const sent = adapter.clickSend(input)
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
