import type { createQueue } from './queue'
import type { createChainExecutor } from './chain_executor'
import styles from './panel.css?inline'

export function createQueuePanel(queue: ReturnType<typeof createQueue>, chain: ReturnType<typeof createChainExecutor>) {
  const host = document.createElement('div')
  host.id = 'langqueue-execution'
  const shadow = host.attachShadow({ mode: 'closed' })
  const style = document.createElement('style')
  style.textContent = styles
  shadow.append(style)
  const panel = document.createElement('section')
  panel.setAttribute('aria-label', 'LangQueue execution')
  panel.innerHTML = `<header><span>LangQueue</span><button type="button" class="toggle" aria-expanded="true">Hide details</button></header><div class="body"><p class="status" role="status" aria-live="polite"></p><p class="message" role="alert"></p><ol></ol><div class="actions"><button type="button" class="retry">Retry unsent prompt</button><button type="button" class="cancel">Cancel queue</button><button type="button" class="cancel-chain">Cancel chain</button><button type="button" class="dismiss">Dismiss</button></div><p class="note">Queued prompts stay in this tab until you reload or leave.</p></div>`
  shadow.append(panel)
  document.documentElement.append(host)
  const status = panel.querySelector<HTMLElement>('.status')!
  const message = panel.querySelector<HTMLElement>('.message')!
  const list = panel.querySelector<HTMLOListElement>('ol')!
  const retry = panel.querySelector<HTMLButtonElement>('.retry')!
  const cancel = panel.querySelector<HTMLButtonElement>('.cancel')!
  const cancelChain = panel.querySelector<HTMLButtonElement>('.cancel-chain')!
  const dismiss = panel.querySelector<HTMLButtonElement>('.dismiss')!
  const toggle = panel.querySelector<HTMLButtonElement>('.toggle')!
  const body = panel.querySelector<HTMLElement>('.body')!
  let notice = ''

  function render() {
    const snapshot = queue.getSnapshot()
    const currentProgress = chain.getSnapshot()
    const progress = currentProgress.totalSteps ? currentProgress : null
    const runningChain = chain.isRunning()
    const labels: Record<string, string> = {
      idle: 'Ready', waiting: 'Waiting for the composer', uploading: 'Uploading attachments',
      sending: 'Sending prompt', awaiting_response: 'Waiting for the response', failed: 'Queue stopped',
      cancelled: 'Cancelled', starting: 'Starting chain', delayed: 'Waiting before the next step',
      completed: 'Chain completed', error: 'Chain stopped',
    }
    const errors: Record<string, string> = {
      QUEUE_CANCELLED: 'Queue cancelled. Check the composer before sending again.',
      QUEUE_CANCELLED_ATTACHMENTS: 'Queue cancelled. Check and clear any attachments left in the composer before sending again.',
      CONVERSATION_REQUIRED: 'Start a conversation first, then run the queue or chain. Your draft was kept.',
      CONVERSATION_CHANGED: 'Execution stopped because the conversation changed. Return to the original conversation to retry unsent work, or remove the queued items.',
      COMPOSER_CHANGED: 'The composer contains a new draft. Save or clear that draft, then retry.',
      COMPOSER_BUSY: 'Finish or cancel the current queue before starting a chain.',
      INPUT_NOT_FOUND: 'The chat input is unavailable. Return to the conversation, then retry.',
      SEND_FAILED: 'The prompt could not be sent. Check the composer, then retry.',
      MODEL_IDLE_TIMEOUT: 'The chat did not become ready in time. Check the conversation before continuing.',
      RESPONSE_TIMEOUT: 'The response did not finish in time. Check the conversation before continuing.',
      GENERATION_START_TIMEOUT: 'Sending was attempted, but no response was detected. Check the conversation before removing this item.',
      ATTACHMENT_UPLOAD_TIMEOUT: 'The attachment upload timed out. Check the files in the composer before retrying.',
      ATTACHMENT_UPLOAD_FAILED: 'An attachment could not be uploaded. Check the files in the composer before retrying.',
    }
    host.hidden = !snapshot.items.length && !notice && !progress && !snapshot.error
    status.textContent = runningChain && progress
      ? `Chain · Step ${progress.stepIndex + 1} of ${progress.totalSteps} · ${labels[progress.status] || progress.status}`
      : snapshot.items.length ? `Queue · ${snapshot.items.length} ${snapshot.items.length === 1 ? 'prompt' : 'prompts'} · ${labels[snapshot.status] || snapshot.status}`
      : snapshot.error ? `Queue · ${labels[snapshot.status] || snapshot.status}`
      : progress ? `Chain · ${labels[progress.status] || progress.status}` : notice ? 'LangQueue notice' : 'Queue cleared'
    const error = snapshot.error || (!snapshot.items.length ? progress?.error : undefined)
    const errorCode = error?.split(/[: ]/, 1)[0]
    const detail = error ? errors[errorCode || ''] || error.replaceAll('_', ' ') : ''
    const recovery = snapshot.items[0]?.attachmentAttempted && snapshot.status === 'failed'
      ? ' Check and clear attachments in the composer, then remove this item and add it again.'
      : error?.includes('may have been sent') ? ' The prompt may have been sent. Check the conversation before restarting.' : ''
    message.textContent = notice || detail + recovery
    message.hidden = !message.textContent
    list.replaceChildren()
    for (const item of snapshot.items) {
      const row = document.createElement('li')
      const text = document.createElement('p')
      text.textContent = item.content || 'Attachment prompt'
      text.title = item.content
      row.append(text)
      if (item.sent) {
        const sent = document.createElement('span')
        sent.className = 'sent'
        sent.textContent = 'Send attempted. This item will not be resent.'
        row.append(sent)
      }
      const remove = document.createElement('button')
      remove.type = 'button'
      remove.className = 'remove'
      remove.textContent = 'Remove'
      remove.disabled = snapshot.running && item.id === snapshot.items[0]?.id
      remove.setAttribute('aria-label', `Remove queued prompt: ${item.content.slice(0, 80)}`)
      remove.addEventListener('click', (event) => { if (event.isTrusted) queue.remove(item.id) })
      row.append(remove)
      list.append(row)
    }
    list.hidden = !snapshot.items.length
    retry.hidden = !snapshot.canRetry
    cancel.hidden = !snapshot.items.length
    cancelChain.hidden = !runningChain
    dismiss.hidden = snapshot.items.length > 0 || runningChain
  }

  retry.addEventListener('click', (event) => { if (!event.isTrusted) return; notice = ''; queue.retry() })
  cancel.addEventListener('click', (event) => { if (!event.isTrusted) return; notice = ''; queue.cancel() })
  cancelChain.addEventListener('click', (event) => {
    if (!event.isTrusted) return
    notice = 'Cancelling. Any upload already in progress must settle before the composer is released.'
    chain.cancel()
    render()
  })
  dismiss.addEventListener('click', (event) => { if (!event.isTrusted) return; notice = ''; queue.clearError(); host.hidden = true })
  toggle.addEventListener('click', (event) => {
    if (!event.isTrusted) return
    body.hidden = !body.hidden
    toggle.textContent = body.hidden ? 'Show details' : 'Hide details'
    toggle.setAttribute('aria-expanded', String(!body.hidden))
  })
  queue.subscribe(render)
  chain.subscribe((progress) => {
    if (['completed', 'error', 'cancelled'].includes(progress.status)) notice = ''
    render()
  })

  function showMessage(text: string) {
    notice = text
    body.hidden = false
    toggle.textContent = 'Hide details'
    toggle.setAttribute('aria-expanded', 'true')
    render()
  }

  return { showMessage }
}
