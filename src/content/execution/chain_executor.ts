import type { Adapter } from '../adapters/adapter';
import type { ChainStep, ChainProgressMessage } from '../../messaging/protocol';
import type { AppSettings } from '../../library/model';
import { createExecutionCoordinator, executeStep, getConversationHref, isConversationReady, assertExecutionContext, waitForExecutionDelay } from './step_execution';

type InputElement = HTMLTextAreaElement | HTMLElement;

const STEP_DELAY_MS = 1500;

export function createChainExecutor(adapter: Adapter, getInput: () => InputElement | null, coordinator = createExecutionCoordinator()) {
  let running = false;
  let cancellationVersion = 0;
  let controller: AbortController | null = null;
  let snapshot: ChainProgressMessage['payload'] = { stepIndex: 0, totalSteps: 0, status: 'completed' };
  const listeners = new Set<(snapshot: ChainProgressMessage['payload']) => void>();

  function publish(next: ChainProgressMessage['payload']) {
    snapshot = next;
    for (const listener of listeners) {
      listener({ ...snapshot });
    }
    try { void chrome.runtime.sendMessage({ type: 'CHAIN_PROGRESS', payload: snapshot }).catch(() => {}); } catch { void 0; }
  }

  function cancel() {
    cancellationVersion += 1;
    controller?.abort();
  }

  async function run(
    steps: ChainStep[],
    settings: AppSettings,
    insertionModeOverride?: 'overwrite' | 'append'
  ): Promise<boolean> {
    if (running) {
      return false;
    }
    if (!isConversationReady()) {
      publish({ stepIndex: 0, totalSteps: steps.length, status: 'error', error: 'CONVERSATION_REQUIRED' });
      return false;
    }
    if (!coordinator.tryAcquire('chain')) {
      publish({ stepIndex: 0, totalSteps: steps.length, status: 'error', error: 'COMPOSER_BUSY' });
      return false;
    }
    running = true;
    controller = new AbortController();
    const mode = insertionModeOverride || settings.insertionMode || 'overwrite';
    const totalSteps = steps.length;
    let stepIndex = 0;
    let sent = false;
    const href = getConversationHref();
    let terminal: ChainProgressMessage['payload'];
    publish({ stepIndex, totalSteps, status: 'starting' });
    try {
      for (; stepIndex < steps.length; stepIndex++) {
        assertExecutionContext(controller.signal, href);
        sent = false;
        await executeStep(adapter, getInput, steps[stepIndex], mode, controller.signal, status => {
          publish({ stepIndex, totalSteps, status });
        }, () => { sent = true; }, undefined, stepIndex > 0 ? '' : undefined, href);
        if (stepIndex < steps.length - 1) {
          publish({ stepIndex, totalSteps, status: 'delayed' });
          await waitForExecutionDelay(STEP_DELAY_MS, controller.signal);
        }
      }
      terminal = { stepIndex: Math.max(0, totalSteps - 1), totalSteps, status: 'completed' };
      return true;
    } catch (cause) {
      const changedConversation = cause instanceof Error && cause.message === 'CONVERSATION_CHANGED';
      const error = changedConversation ? 'CONVERSATION_CHANGED' : controller.signal.aborted ? 'Chain cancelled' : cause instanceof Error ? cause.message : 'EXECUTION_FAILED';
      terminal = { stepIndex, totalSteps, status: controller.signal.aborted && !changedConversation ? 'cancelled' : 'error', error: sent && error !== 'SEND_FAILED' ? `${error}: the prompt may have been sent. Check the conversation before restarting.` : error };
      return false;
    } finally {
      running = false;
      controller = null;
      publish(terminal!);
      coordinator.release();
    }
  }

  function stopForNavigation() {
    cancellationVersion += 1;
    controller?.abort(new Error('CONVERSATION_CHANGED'));
  }

  function subscribe(listener: (snapshot: ChainProgressMessage['payload']) => void) {
    listeners.add(listener);
    listener({ ...snapshot });
    return () => { listeners.delete(listener); };
  }

  return { run, cancel, isRunning: () => running, getCancellationVersion: () => cancellationVersion, getSnapshot: () => ({ ...snapshot }), subscribe, stopForNavigation };
}
