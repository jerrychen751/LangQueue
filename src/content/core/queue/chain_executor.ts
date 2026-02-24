import type { Adapter } from '../../adapters/adapter'
import type { ChainStep } from '../../../types/messages'
import type { AppSettings } from '../../../types'
import { appendInputText, setInputText } from '../insert/composer'
import { fetchAttachmentFiles } from '../messaging'

type InputElement = HTMLTextAreaElement | HTMLElement

const STEP_DELAY_MS = 1500

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
    const mode = insertionModeOverride || settings.insertionMode || 'overwrite'
    const totalSteps = steps.length
    chrome.runtime.sendMessage({ type: 'CHAIN_PROGRESS', payload: { stepIndex: 0, totalSteps, status: 'starting' } })

    try {
      for (let i = 0; i < steps.length; i++) {
        if (cancelled) {
          chrome.runtime.sendMessage({ type: 'CHAIN_PROGRESS', payload: { stepIndex: i, totalSteps, status: 'cancelled' } })
          return false
        }

        const input = getInput() || adapter.getInputElement()
        if (!input) {
          chrome.runtime.sendMessage({ type: 'CHAIN_PROGRESS', payload: { stepIndex: i, totalSteps, status: 'error', error: 'INPUT_NOT_FOUND' } })
          return false
        }

        const step = steps[i]
        if (Array.isArray(step.attachments) && step.attachments.length > 0) {
          const files = await fetchAttachmentFiles(step.attachments)
          const attached = await adapter.attachFiles(files)
          if (!attached.ok) {
            chrome.runtime.sendMessage({ type: 'CHAIN_PROGRESS', payload: { stepIndex: i, totalSteps, status: 'error', error: attached.error || 'ATTACHMENT_UPLOAD_FAILED' } })
            return false
          }
          const uploaded = await adapter.waitForUploadsComplete({ timeoutMs: 120000, pollMs: 250 })
          if (!uploaded) {
            chrome.runtime.sendMessage({ type: 'CHAIN_PROGRESS', payload: { stepIndex: i, totalSteps, status: 'error', error: 'ATTACHMENT_UPLOAD_TIMEOUT' } })
            return false
          }
        }

        if (mode === 'append') {
          appendInputText(input, step.content)
        } else {
          setInputText(input, step.content)
        }

        chrome.runtime.sendMessage({ type: 'CHAIN_PROGRESS', payload: { stepIndex: i, totalSteps, status: 'sending' } })
        const sent = adapter.clickSend(input as HTMLTextAreaElement)
        if (!sent) {
          chrome.runtime.sendMessage({ type: 'CHAIN_PROGRESS', payload: { stepIndex: i, totalSteps, status: 'error', error: 'SEND_FAILED' } })
          return false
        }

        chrome.runtime.sendMessage({ type: 'CHAIN_PROGRESS', payload: { stepIndex: i, totalSteps, status: 'awaiting_response' } })
        await adapter.waitForIdle({ timeoutMs: 120000, pollMs: 200 })

        if (i < steps.length - 1) {
          chrome.runtime.sendMessage({ type: 'CHAIN_PROGRESS', payload: { stepIndex: i, totalSteps, status: 'delayed' } })
          await new Promise((r) => setTimeout(r, STEP_DELAY_MS))
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
