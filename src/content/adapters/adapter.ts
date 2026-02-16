import { isInputReady } from './utils'

export abstract class Adapter {
  /** The name of the LLM */
  abstract id: string

  /** Check whether this adapter should be used on the user's current tab */
  abstract matchesAdapterDomain(): boolean

  /** Find and return the chat input element on the page for where prompts go */
  abstract getInputElement(): HTMLTextAreaElement | null

  /** Check whether the model is currently generating an output */
  abstract isGenerating(): boolean

  /** Automate the action of clicking send button for a prompt input. */
  abstract clickSend(input?: HTMLTextAreaElement | null): boolean

  /**
   * Polling mechanism to wait until a timeout or completion of LLM generation, whichever comes first.
   */
  async waitForIdle(options?: { timeoutMs?: number; pollMs?: number }): Promise<boolean> {
    const timeoutMs = options?.timeoutMs ?? 30 * 60 * 1000 // 30 minutes default timeout
    const pollMs = options?.pollMs ?? 500 // 500 ms default poll interval
    const start = Date.now()
    while (Date.now() - start < timeoutMs) {
      const input = this.getInputElement()
      if (!this.isGenerating() && isInputReady(input)) return true
      await new Promise((resolve) => setTimeout(resolve, pollMs))
    }
    return false
  }

  abstract attachFiles(files: File[]): Promise<{ ok: boolean; error?: string }>
  abstract waitForUploadsComplete(options?: { timeoutMs?: number; pollMs?: number }): Promise<boolean>
}
