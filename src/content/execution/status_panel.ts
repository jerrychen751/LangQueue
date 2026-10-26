import type { createQueue } from './queue';
import type { createChainExecutor } from './chain_executor';
import styles from './status_panel.css?inline';

export function createQueuePanel(queue: ReturnType<typeof createQueue>, chain: ReturnType<typeof createChainExecutor>) {
  const host = document.createElement('div');
  host.id = 'langqueue-execution';
  const shadow = host.attachShadow({ mode: 'closed' });
  const style = document.createElement('style');
  style.textContent = styles;
  shadow.append(style);
  const panel = document.createElement('section');
  panel.setAttribute('aria-label', 'LangQueue execution');
  panel.innerHTML = `<header><span class="title">LangQueue</span><button type="button" class="toggle" aria-expanded="true">Hide</button></header><div class="body"><div class="status" role="status" aria-live="polite"><span class="kind"></span><span class="count"></span><span class="state"></span></div><p class="message" role="alert"></p><ol></ol><div class="actions"><button type="button" class="retry">Retry</button><button type="button" class="cancel">Cancel queue</button><button type="button" class="cancel-chain">Cancel chain</button><button type="button" class="dismiss">Dismiss</button></div></div>`;
  shadow.append(panel);
  document.documentElement.append(host);
  const status = panel.querySelector<HTMLElement>('.status')!;
  const kind = panel.querySelector<HTMLElement>('.kind')!;
  const count = panel.querySelector<HTMLElement>('.count')!;
  const state = panel.querySelector<HTMLElement>('.state')!;
  const message = panel.querySelector<HTMLElement>('.message')!;
  const list = panel.querySelector<HTMLOListElement>('ol')!;
  const retry = panel.querySelector<HTMLButtonElement>('.retry')!;
  const cancel = panel.querySelector<HTMLButtonElement>('.cancel')!;
  const cancelChain = panel.querySelector<HTMLButtonElement>('.cancel-chain')!;
  const dismiss = panel.querySelector<HTMLButtonElement>('.dismiss')!;
  const toggle = panel.querySelector<HTMLButtonElement>('.toggle')!;
  const body = panel.querySelector<HTMLElement>('.body')!;
  let notice = '';

  function render() {
    const snapshot = queue.getSnapshot();
    // A cancel the user asked for that left nothing behind is not an error to report
    const queueError = snapshot.error === 'QUEUE_CANCELLED' && !snapshot.items.length ? null : snapshot.error;
    const currentProgress = chain.getSnapshot();
    const progress = currentProgress.totalSteps && currentProgress.error !== 'CHAIN_CANCELLED' ? currentProgress : null;
    const runningChain = chain.isRunning();
    const labels: Record<string, string> = {
      idle: 'Ready', waiting: 'Waiting', uploading: 'Uploading', sending: 'Sending', awaiting_response: 'Responding',
      failed: 'Stopped', cancelled: 'Cancelled', starting: 'Starting', delayed: 'Waiting', completed: 'Done', error: 'Stopped',
    };
    const errors: Record<string, string> = {
      // The user just pressed Cancel, so these two need no message
      QUEUE_CANCELLED: '',
      CHAIN_CANCELLED: '',
      QUEUE_CANCELLED_ATTACHMENTS: 'Files may still be attached in the chat box.',
      CONVERSATION_REQUIRED: 'Send the first message and let the chat load, then try again.',
      CONVERSATION_CHANGED: 'This belongs to another chat. Go back to it to retry.',
      COMPOSER_CHANGED: 'Clear your draft from the chat box, then retry.',
      COMPOSER_BUSY: 'Finish or cancel the queue first.',
      INPUT_NOT_FOUND: 'Couldn\'t find the chat box.',
      SEND_FAILED: 'Send failed.',
      SEND_UNCERTAIN: 'This may have been sent. Check the chat before you send it again.',
      MODEL_IDLE_TIMEOUT: 'The chat was still busy after 30 minutes.',
      RESPONSE_TIMEOUT: 'The response didn\'t finish within 30 minutes.',
      GENERATION_START_TIMEOUT: 'No response started. This may have been sent, so check the chat.',
      ATTACHMENT_UPLOAD_TIMEOUT: 'Couldn\'t confirm the upload. Check the files in the chat box.',
      ATTACHMENT_UPLOAD_FAILED: 'Upload failed.',
      ATTACHMENT_NOT_FOUND: 'A file saved with this prompt is missing. Add it to the prompt again.',
      EXECUTION_FAILED: 'Something went wrong.',
    };
    host.hidden = !snapshot.items.length && !notice && !progress && !queueError;
    const shown = runningChain && progress ? { kind: 'Chain', count: `${progress.stepIndex + 1} / ${progress.totalSteps}`, state: progress.status }
      : snapshot.items.length ? { kind: 'Queue', count: String(snapshot.items.length), state: snapshot.status }
      : queueError ? { kind: 'Queue', count: '', state: snapshot.status }
      : progress ? { kind: 'Chain', count: '', state: progress.status } : null;
    status.hidden = !shown;
    kind.textContent = shown?.kind ?? '';
    count.textContent = shown?.count ?? '';
    state.textContent = shown ? labels[shown.state] || shown.state : '';
    state.dataset.tone = !shown ? '' : shown.state === 'failed' || shown.state === 'error' ? 'error'
      : shown.state === 'completed' ? 'done'
      : ['starting', 'uploading', 'sending', 'awaiting_response'].includes(shown.state) ? 'active' : '';
    const error = queueError || (!snapshot.items.length ? progress?.error : undefined);
    const errorCode = error?.split(/[: ]/, 1)[0];
    const detail = error ? errors[errorCode || ''] ?? error.replaceAll('_', ' ') : '';
    const recovery = snapshot.items[0]?.attachmentAttempted && !snapshot.items[0].sent && snapshot.status === 'failed'
      ? 'Remove the files from the chat box, then remove this item and queue it again.'
      : error?.includes('may have been sent') && !detail.includes('may have been sent') ? 'The last prompt may have been sent.' : '';
    message.textContent = notice || [detail, recovery].filter(Boolean).join(' ');
    message.dataset.tone = !notice && (snapshot.status === 'failed' || progress?.status === 'error') ? 'error' : '';
    message.hidden = !message.textContent;
    list.replaceChildren();
    for (const item of snapshot.items) {
      const row = document.createElement('li');
      row.dataset.current = String(snapshot.running && item.id === snapshot.items[0]?.id);
      const text = document.createElement('p');
      text.textContent = item.content || 'Attachments';
      text.title = item.content;
      row.append(text);
      if (item.sent) {
        const sent = document.createElement('span');
        sent.className = 'sent';
        sent.textContent = snapshot.running ? 'Sent' : 'Remove this to continue';
        row.append(sent);
      }
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'remove';
      remove.textContent = '×';
      remove.disabled = snapshot.running && item.id === snapshot.items[0]?.id;
      remove.setAttribute('aria-label', `Remove queued prompt: ${item.content.slice(0, 80)}`);
      remove.addEventListener('click', (event) => {
        if (event.isTrusted) {
          queue.remove(item.id);
        }
      });
      row.append(remove);
      list.append(row);
    }
    list.hidden = !snapshot.items.length;
    retry.hidden = !snapshot.canRetry;
    cancel.hidden = !snapshot.items.length;
    cancelChain.hidden = !runningChain;
    dismiss.hidden = snapshot.items.length > 0 || runningChain;
  }

  retry.addEventListener('click', (event) => {
    if (!event.isTrusted) {
      return;
    }
    notice = '';
    queue.retry();
  });
  cancel.addEventListener('click', (event) => {
    if (!event.isTrusted) {
      return;
    }
    notice = '';
    queue.cancel();
  });
  cancelChain.addEventListener('click', (event) => {
    if (!event.isTrusted) {
      return;
    }
    notice = 'Cancelling…';
    chain.cancel();
    render();
  });
  dismiss.addEventListener('click', (event) => {
    if (!event.isTrusted) {
      return;
    }
    notice = '';
    queue.clearError();
    host.hidden = true;
  });
  toggle.addEventListener('click', (event) => {
    if (!event.isTrusted) {
      return;
    }
    body.hidden = !body.hidden;
    toggle.textContent = body.hidden ? 'Show' : 'Hide';
    toggle.setAttribute('aria-expanded', String(!body.hidden));
  });
  queue.subscribe(render);
  chain.subscribe((progress) => {
    if (['completed', 'error', 'cancelled'].includes(progress.status)) {
      notice = '';
    }
    render();
  });

  function showMessage(text: string) {
    notice = text;
    body.hidden = false;
    toggle.textContent = 'Hide';
    toggle.setAttribute('aria-expanded', 'true');
    render();
  }

  return { showMessage };
}
