export type InjectPromptMessage = {
  type: 'INJECT_PROMPT'
  payload: { content: string }
}

export type TextareaReadyMessage = {
  type: 'TEXTAREA_READY'
}

export type OpenPopupMessage = {
  type: 'OPEN_POPUP'
}

export type CompatCheckMessage = { type: 'COMPAT_CHECK' }
export type CompatStatusMessage = { type: 'COMPAT_STATUS'; payload: { ready: boolean } }
export type InjectPromptResultMessage = { type: 'INJECT_PROMPT_RESULT'; payload: { ok: boolean; reason?: string } }
export type InjectPromptErrorMessage = { type: 'INJECT_PROMPT_ERROR'; payload: { reason: 'TEXTAREA_NOT_FOUND' | 'UNKNOWN' } }

// Prompt chaining types
export type ChainStep = {
  content: string
  autoSend?: boolean
  awaitResponse?: boolean
  delayMs?: number
}

export type RunChainMessage = {
  type: 'RUN_CHAIN'
  payload: { steps: ChainStep[]; insertionModeOverride?: 'overwrite' | 'append' }
}

export type ChainProgressMessage = {
  type: 'CHAIN_PROGRESS'
  payload: {
    stepIndex: number
    totalSteps: number
    status: 'starting' | 'sending' | 'awaiting_response' | 'delayed' | 'completed' | 'cancelled' | 'error'
    error?: string
  }
}

export type CancelChainMessage = {
  type: 'CANCEL_CHAIN'
}

export type KnownMessage =
  | InjectPromptMessage
  | TextareaReadyMessage
  | OpenPopupMessage
  | CompatCheckMessage
  | CompatStatusMessage
  | InjectPromptResultMessage
  | InjectPromptErrorMessage
  | RunChainMessage
  | ChainProgressMessage
  | CancelChainMessage


