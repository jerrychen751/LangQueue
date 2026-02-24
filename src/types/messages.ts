import type { AppSettings, Platform, AttachmentRef, PromptStep } from './index'

export interface PromptData {
  id: string
  title: string
  content: string
  attachments: AttachmentRef[]
}

export interface ChainData {
  id: string
  title: string
  steps: PromptStep[]
}

export type InjectPromptMessage = {
  type: 'INJECT_PROMPT'
  payload: { content: string; attachments?: AttachmentRef[] }
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
export type PromptSearchResultMessage = { type: 'PROMPT_SEARCH_RESULT'; payload: { prompts: PromptData[] } }

export type ChainSearchMessage = { type: 'CHAIN_SEARCH'; payload: { query: string; limit?: number } }
export type ChainSearchResultMessage = { type: 'CHAIN_SEARCH_RESULT'; payload: { chains: ChainData[] } }

export type LogUsageMessage = { type: 'LOG_USAGE'; payload: { promptId: string; platform: Platform } }

export type OpenPromptEditorMessage = { type: 'OPEN_PROMPT_EDITOR'; payload: { promptId: string } }

export type PromptUpdateMessage = { type: 'PROMPT_UPDATE'; payload: { id: string; title: string; content: string; attachments?: AttachmentRef[] } }
export type PromptUpdateResultMessage = { type: 'PROMPT_UPDATE_RESULT'; payload: { ok: boolean; error?: string } }
export type PromptDeleteMessage = { type: 'PROMPT_DELETE'; payload: { id: string } }
export type PromptDeleteResultMessage = { type: 'PROMPT_DELETE_RESULT'; payload: { ok: boolean; error?: string } }
export type PromptCreateMessage = { type: 'PROMPT_CREATE'; payload: { title: string; content: string; attachments?: AttachmentRef[] } }
export type PromptCreateResultMessage = { type: 'PROMPT_CREATE_RESULT'; payload: { ok: boolean; id?: string; error?: string } }

// Prompt chaining types
export type ChainStep = {
  content: string
  attachments?: AttachmentRef[]
}

export type RunChainMessage = {
  type: 'RUN_CHAIN'
  payload: { steps: ChainStep[]; insertionModeOverride?: 'overwrite' | 'append' }
}

export type AttachmentGetMetaMessage = {
  type: 'ATTACHMENT_GET_META'
  payload: { ids: string[] }
}

export type AttachmentGetMetaResultMessage = {
  type: 'ATTACHMENT_GET_META_RESULT'
  payload: { ok: boolean; attachments: AttachmentRef[]; missingIds: string[]; error?: string }
}

export type AttachmentGetChunkMessage = {
  type: 'ATTACHMENT_GET_CHUNK'
  payload: { id: string; offset: number; length: number }
}

export type AttachmentGetChunkResultMessage = {
  type: 'ATTACHMENT_GET_CHUNK_RESULT'
  payload: {
    ok: boolean
    id: string
    offset: number
    nextOffset: number
    totalBytes: number
    chunkBase64: string
    done: boolean
    error?: string
  }
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
  | ChainSearchMessage
  | ChainSearchResultMessage
  | LogUsageMessage
  | OpenPromptEditorMessage
  | PromptUpdateMessage
  | PromptUpdateResultMessage
  | PromptDeleteMessage
  | PromptDeleteResultMessage
  | PromptCreateMessage
  | PromptCreateResultMessage
  | AttachmentGetMetaMessage
  | AttachmentGetMetaResultMessage
  | AttachmentGetChunkMessage
  | AttachmentGetChunkResultMessage
