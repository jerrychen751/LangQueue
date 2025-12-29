export type InputElement = HTMLTextAreaElement | HTMLElement

export type AdapterId = 'chatgpt' | 'claude' | 'gemini'

export type WaitForIdleOptions = {
  timeoutMs?: number
  pollMs?: number
}

export interface Adapter {
  id: AdapterId
  matches(): boolean
  findInput(): InputElement | null
  isGenerating(): boolean
  clickSend(input?: InputElement | null): boolean
  waitForIdle(options?: WaitForIdleOptions): Promise<boolean>
}

