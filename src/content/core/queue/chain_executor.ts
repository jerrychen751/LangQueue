import type { Adapter, InputElement } from '../types'
import type { ChainStep } from '../../../types/messages'
import type { AppSettings } from '../../../types'
import { appendInputText, setInputText } from '../insert/composer'

type ChainDefaults = {
  autoSend?: boolean
  awaitResponse?: boolean
  defaultDelayMs?: number
}

export function createChainExecutor(adapter: Adapter, getInput: () => InputElement | null) {
  let running = false
  let cancelled = false

  function cancel() {
    cancelled = true
  }

  async function run(
    steps: ChainStep[],
    settings: AppSettings,
    insertionModeOverride?: 'overwrite' | 'append'
  ): Promise<boolean> {
    if (running) return false
    running = true
    cancelled = false
    const defaults = (settings.chainDefaults || {}) as ChainDefaults
    const mode = insertionModeOverride || settings.insertionMode || 'overwrite'
    const totalSteps = steps.length
    chrome.runtime.sendMessage({ type: 'CHAIN_PROGRESS', payload: { stepIndex: 0, totalSteps, status: 'starting' } })

    try {
      for (let i = 0; i < steps.length; i++) {
        if (cancelled) {
          chrome.runtime.sendMessage({ type: 'CHAIN_PROGRESS', payload: { stepIndex: i, totalSteps, status: 'cancelled' } })
          return false
        }

        const input = getInput() || adapter.findInput()
        if (!input) {
          chrome.runtime.sendMessage({ type: 'CHAIN_PROGRESS', payload: { stepIndex: i, totalSteps, status: 'error', error: 'INPUT_NOT_FOUND' } })
          return false
        }

        const step = steps[i]
        if (mode === 'append') {
          appendInputText(input, step.content)
        } else {
          setInputText(input, step.content)
        }

        const shouldAutoSend = typeof step.autoSend === 'boolean' ? step.autoSend : (typeof defaults.autoSend === 'boolean' ? defaults.autoSend : true)
        const shouldAwait = typeof step.awaitResponse === 'boolean' ? step.awaitResponse : (typeof defaults.awaitResponse === 'boolean' ? defaults.awaitResponse : true)
        const delayMs = typeof step.delayMs === 'number' ? step.delayMs : (typeof defaults.defaultDelayMs === 'number' ? defaults.defaultDelayMs : 0)

        if (shouldAutoSend) {
          chrome.runtime.sendMessage({ type: 'CHAIN_PROGRESS', payload: { stepIndex: i, totalSteps, status: 'sending' } })
          const sent = adapter.clickSend(input)
          if (!sent) {
            chrome.runtime.sendMessage({ type: 'CHAIN_PROGRESS', payload: { stepIndex: i, totalSteps, status: 'error', error: 'SEND_FAILED' } })
            return false
          }
          if (shouldAwait) {
            chrome.runtime.sendMessage({ type: 'CHAIN_PROGRESS', payload: { stepIndex: i, totalSteps, status: 'awaiting_response' } })
            await adapter.waitForIdle({ timeoutMs: 120000, pollMs: 200 })
            await new Promise((r) => setTimeout(r, 150))
          }
        }

        if (delayMs > 0) {
          chrome.runtime.sendMessage({ type: 'CHAIN_PROGRESS', payload: { stepIndex: i, totalSteps, status: 'delayed' } })
          await new Promise((r) => setTimeout(r, delayMs))
        }
      }

      chrome.runtime.sendMessage({ type: 'CHAIN_PROGRESS', payload: { stepIndex: steps.length - 1, totalSteps: steps.length, status: 'completed' } })
      return true
    } finally {
      running = false
    }
  }

  function isRunning() {
    return running
  }

  return {
    run,
    cancel,
    isRunning,
  }
}
