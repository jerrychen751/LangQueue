import type { Adapter } from '../../adapters/adapter'
import { isInputReady } from '../../adapters/utils'
import { appendInputText, getInputText, setInputText } from '../insert/composer'
import { fetchAttachmentFiles } from '../messaging'
import type { AttachmentRef } from '../../../types'

export function createExecutionCoordinator() {
  let owner: 'queue' | 'chain' | 'manual' | null = null
  let pending = 0
  const listeners = new Set<() => void>()
  return {
    tryAcquire(next: 'queue' | 'chain' | 'manual') {
      if (owner || (next !== 'queue' && pending > 0)) return false
      owner = next
      return true
    },
    release() {
      owner = null
      for (const listener of listeners) listener()
    },
    setQueuePending(count: number) { pending = count },
    getOwner() { return owner },
    isBusy() { return owner !== null || pending > 0 },
    subscribe(listener: () => void) {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
  }
}

export function getConversationHref() {
  return globalThis.location?.href ?? ''
}

export function isConversationReady(href = getConversationHref()) {
  if (!href) return false
  const { hostname, pathname } = new URL(href)
  if (/(^|\.)chatgpt\.com$/.test(hostname) || /(^|\.)chat\.openai\.com$/.test(hostname)) {
    return /^\/(?:g\/[^/]+\/)?c\/[^/]+\/?$/.test(pathname)
  }
  if (/(^|\.)claude\.ai$/.test(hostname)) return /^\/chat\/[^/]+\/?$/.test(pathname)
  if (/(^|\.)gemini\.google\.com$/.test(hostname)) return /^\/app\/[^/]+\/?$/.test(pathname)
  return false
}

export function assertExecutionContext(signal: AbortSignal, href: string) {
  signal.throwIfAborted()
  if (getConversationHref() !== href) throw new Error('CONVERSATION_CHANGED')
  if (!isConversationReady(href)) throw new Error('CONVERSATION_REQUIRED')
}

export type ExecutionStatus = 'waiting' | 'uploading' | 'sending' | 'awaiting_response'

export async function waitForExecutionDelay(ms: number, signal: AbortSignal) {
  signal.throwIfAborted()
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', handleAbort)
      resolve()
    }, ms)
    function handleAbort() {
      clearTimeout(timer)
      reject(signal.reason)
    }
    signal.addEventListener('abort', handleAbort, { once: true })
  })
}

export async function executeStep(
  adapter: Adapter,
  getInput: () => HTMLTextAreaElement | HTMLElement | null,
  item: { content: string; attachments?: AttachmentRef[] },
  mode: 'overwrite' | 'append',
  signal: AbortSignal,
  onStatus: (status: ExecutionStatus) => void,
  onSend: () => void,
  timing = { timeoutMs: 120000, startTimeoutMs: 15000, pollMs: 200 },
  allowedInput?: string,
  href = getConversationHref(),
) {
  assertExecutionContext(signal, href)
  const initialText = getInputText(getInput() || adapter.getInputElement())
  onStatus('waiting')
  if (allowedInput !== undefined && initialText !== '' && initialText !== allowedInput) {
    throw new Error('COMPOSER_CHANGED: save or clear your draft, then retry.')
  }
  let startedAt = Date.now()
  while (adapter.isGenerating() || !isInputReady(adapter.getInputElement())) {
    assertExecutionContext(signal, href)
    if (Date.now() - startedAt >= timing.timeoutMs) throw new Error('MODEL_IDLE_TIMEOUT')
    await waitForExecutionDelay(timing.pollMs, signal)
  }
  assertExecutionContext(signal, href)
  if (item.attachments?.length) {
    onStatus('uploading')
    const files = await fetchAttachmentFiles(item.attachments)
    assertExecutionContext(signal, href)
    const attached = await adapter.attachFiles(files)
    if (!attached.ok) throw new Error(attached.error || 'ATTACHMENT_UPLOAD_FAILED')
    const uploaded = await adapter.waitForUploadsComplete({ timeoutMs: 120000, pollMs: timing.pollMs })
    assertExecutionContext(signal, href)
    if (!uploaded) throw new Error('ATTACHMENT_UPLOAD_TIMEOUT')
  }
  assertExecutionContext(signal, href)
  const input = getInput() || adapter.getInputElement()
  if (!input) throw new Error('INPUT_NOT_FOUND')
  const currentText = getInputText(input)
  if (currentText !== initialText || (allowedInput !== undefined && currentText !== '' && currentText !== allowedInput)) {
    throw new Error('COMPOSER_CHANGED: save or clear your draft, then retry.')
  }
  if (mode === 'append') appendInputText(input, item.content)
  else setInputText(input, item.content)
  assertExecutionContext(signal, href)
  onStatus('sending')
  onSend()
  if (!adapter.clickSend(input as HTMLTextAreaElement)) throw new Error('SEND_FAILED')
  onStatus('awaiting_response')
  startedAt = Date.now()
  while (!adapter.isGenerating()) {
    assertExecutionContext(signal, href)
    if (Date.now() - startedAt >= timing.startTimeoutMs) throw new Error('GENERATION_START_TIMEOUT')
    await waitForExecutionDelay(timing.pollMs, signal)
  }
  startedAt = Date.now()
  while (adapter.isGenerating() || !isInputReady(adapter.getInputElement())) {
    assertExecutionContext(signal, href)
    if (Date.now() - startedAt >= timing.timeoutMs) throw new Error('RESPONSE_TIMEOUT')
    await waitForExecutionDelay(timing.pollMs, signal)
  }
  assertExecutionContext(signal, href)
}
