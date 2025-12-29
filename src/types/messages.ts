import type { AppSettings, Platform, PromptSummary } from './index'

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
export type ClickSendMessage = { type: 'CLICK_SEND' }

export type GetSettingsMessage = { type: 'GET_SETTINGS' }
export type SettingsResultMessage = { type: 'SETTINGS_RESULT'; payload: { settings: AppSettings } }

export type PromptSearchMessage = { type: 'PROMPT_SEARCH'; payload: { query: string; limit?: number } }
export type PromptSearchResultMessage = { type: 'PROMPT_SEARCH_RESULT'; payload: { prompts: PromptSummary[] } }

export type LogUsageMessage = { type: 'LOG_USAGE'; payload: { promptId: string; platform: Platform } }

export type OpenPromptEditorMessage = { type: 'OPEN_PROMPT_EDITOR'; payload: { promptId: string } }

export type PromptUpdateMessage = { type: 'PROMPT_UPDATE'; payload: { id: string; title: string; content: string } }
export type PromptUpdateResultMessage = { type: 'PROMPT_UPDATE_RESULT'; payload: { ok: boolean; error?: string } }
export type PromptDeleteMessage = { type: 'PROMPT_DELETE'; payload: { id: string } }
export type PromptDeleteResultMessage = { type: 'PROMPT_DELETE_RESULT'; payload: { ok: boolean; error?: string } }
export type PromptCreateMessage = { type: 'PROMPT_CREATE'; payload: { title: string; content: string } }
export type PromptCreateResultMessage = { type: 'PROMPT_CREATE_RESULT'; payload: { ok: boolean; id?: string; error?: string } }

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
  | ClickSendMessage
  | GetSettingsMessage
  | SettingsResultMessage
  | PromptSearchMessage
  | PromptSearchResultMessage
  | LogUsageMessage
  | OpenPromptEditorMessage
  | PromptUpdateMessage
  | PromptUpdateResultMessage
  | PromptDeleteMessage
  | PromptDeleteResultMessage
  | PromptCreateMessage
  | PromptCreateResultMessage
