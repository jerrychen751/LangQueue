import type { Adapter } from '../../adapters/adapter'
import type { AttachmentRef } from '../../../types'
import { createExecutionCoordinator, executeStep, getConversationHref, isConversationReady, type ExecutionStatus } from './execution'

type InputElement = HTMLTextAreaElement | HTMLElement

export type QueueItem = {
  content: string
  attachments?: AttachmentRef[]
  promptId?: string
}

export function createQueue(adapter: Adapter, getInput: () => InputElement | null, coordinator = createExecutionCoordinator()) {
  const items: (QueueItem & { id: string; sent: boolean; attachmentAttempted: boolean; preparedContent: string; href: string })[] = []
  let running = false
  let status: ExecutionStatus | 'idle' | 'failed' | 'cancelled' = 'idle'
  let error: string | null = null
  let controller: AbortController | null = null
  const listeners = new Set<(snapshot: ReturnType<typeof getSnapshot>) => void>()

  function getSnapshot() {
    return { status, running, items: items.map(item => ({ ...item })), error, canRetry: !running && status === 'failed' && !!items.length && !items[0].sent && !items[0].attachmentAttempted && items[0].href === getConversationHref() }
  }

  function publish() {
    coordinator.setQueuePending(items.length)
    for (const listener of listeners) listener(getSnapshot())
  }

  async function flush() {
    if (running || !items.length || status === 'failed' || status === 'cancelled') return
    if (!coordinator.tryAcquire('queue')) {
      status = 'waiting'
      publish()
      return
    }
    running = true
    controller = new AbortController()
    try {
      while (items.length) {
        const item = items[0]
        await executeStep(adapter, getInput, item, 'overwrite', controller.signal, next => {
          status = next
          if (next === 'uploading') item.attachmentAttempted = true
          if (next === 'sending') item.preparedContent = item.content
          publish()
        }, () => { item.sent = true }, { timeoutMs: 1800000, startTimeoutMs: 15000, pollMs: 200 }, item.preparedContent, item.href)
        items.shift()
        publish()
      }
      status = 'idle'
    } catch (cause) {
      const changedConversation = cause instanceof Error && cause.message === 'CONVERSATION_CHANGED'
      status = controller.signal.aborted && !changedConversation ? 'cancelled' : 'failed'
      error = changedConversation ? 'CONVERSATION_CHANGED' : controller.signal.aborted ? 'QUEUE_CANCELLED' : cause instanceof Error ? cause.message : 'EXECUTION_FAILED'
      if (error === 'SEND_FAILED' && items[0]) items[0].sent = false
      if (controller.signal.aborted && !changedConversation && !items[0]?.sent) {
        const cancelledItem = items.shift()
        if (cancelledItem?.attachmentAttempted) error = 'QUEUE_CANCELLED_ATTACHMENTS'
      }
      if (items[0]?.attachmentAttempted && !items[0].sent) error += ' Check and clear attachments in the composer before removing this item and adding it again.'
    } finally {
      running = false
      controller = null
      publish()
      coordinator.release()
    }
  }

  function enqueue(item: QueueItem) {
    if (!isConversationReady()) {
      error = 'CONVERSATION_REQUIRED'
      if (!running) status = 'failed'
      publish()
      return false
    }
    if (controller?.signal.aborted) return false
    items.push({ ...item, id: crypto.randomUUID(), sent: false, attachmentAttempted: false, preparedContent: '', href: getConversationHref() })
    if ((status === 'cancelled' || status === 'failed') && items.length === 1) { status = 'idle'; error = null }
    publish()
    void flush()
    return true
  }

  function remove(id: string) {
    const index = items.findIndex(item => item.id === id)
    if (index < 0 || (running && index === 0)) return
    items.splice(index, 1)
    if (!items.length || index === 0) { status = 'idle'; error = null }
    publish()
    void flush()
  }

  function retry() {
    if (!getSnapshot().canRetry) return
    status = 'idle'
    error = null
    void flush()
  }

  function cancel() {
    controller?.abort()
    if (running) items.splice(1)
    else items.splice(0)
    status = 'cancelled'
    error = 'QUEUE_CANCELLED'
    publish()
  }

  function stopForNavigation() {
    controller?.abort(new Error('CONVERSATION_CHANGED'))
    if (items.length) { status = 'failed'; error = 'CONVERSATION_CHANGED' }
    publish()
  }

  function clearError() {
    if (running || items.length) return
    error = null
    status = 'idle'
    publish()
  }

  function subscribe(listener: (snapshot: ReturnType<typeof getSnapshot>) => void) {
    listeners.add(listener)
    listener(getSnapshot())
    return () => { listeners.delete(listener) }
  }

  coordinator.subscribe(() => { void flush() })
  return { enqueue, flush, size: () => items.length, getSnapshot, subscribe, remove, retry, cancel, stopForNavigation, clearError }
}
