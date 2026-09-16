import type { AppSettings, Platform, AttachmentRef, PromptStep } from '../library/model'

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

export type InsertPromptResult = { ok: boolean; sendAttempted: boolean; reason?: string }

export type BackgroundRequests = {
  GET_SETTINGS: { payload: undefined; result: AppSettings }
  SAVE_SETTINGS: { payload: { settings: AppSettings }; result: void }
  PROMPT_SEARCH: { payload: { query: string; limit?: number }; result: PromptData[] }
  CHAIN_SEARCH: { payload: { query: string; limit?: number }; result: ChainData[] }
  PROMPT_CREATE: { payload: { title: string; content: string; attachments?: AttachmentRef[] }; result: { id: string } }
  PROMPT_UPDATE: { payload: { id: string; title: string; content: string; attachments?: AttachmentRef[] }; result: void }
  PROMPT_DELETE: { payload: { id: string }; result: void }
  LOG_USAGE: { payload: { promptId: string; platform: Platform }; result: void }
  OPEN_PROMPT_EDITOR: { payload: { promptId: string }; result: void }
  ATTACHMENT_GET_META: { payload: { ids: string[] }; result: { attachments: AttachmentRef[]; missingIds: string[] } }
  ATTACHMENT_GET_CHUNK: { payload: { id: string; offset: number; length: number }; result: { chunkBase64: string; nextOffset: number; totalBytes: number; done: boolean } }
}

export type TabRequests = {
  COMPAT_CHECK: { payload: undefined; result: { ready: boolean } }
  INJECT_PROMPT: { payload: { content: string; attachments?: AttachmentRef[]; expectedHref: string }; result: InsertPromptResult }
  INSERT_AND_SEND_PROMPT: { payload: { content: string; attachments?: AttachmentRef[]; expectedHref: string }; result: InsertPromptResult }
  RUN_CHAIN: { payload: { steps: ChainStep[]; expectedHref: string; insertionModeOverride?: 'overwrite' | 'append' }; result: { ok: boolean; reason?: string } }
  CANCEL_CHAIN: { payload: undefined; result: void }
}

export type RequestResponse<Result> = { ok: true; result: Result } | { ok: false; error: string }

// Prompt chaining types
export type ChainStep = {
  content: string
  attachments?: AttachmentRef[]
}

export type ChainProgressMessage = {
  type: 'CHAIN_PROGRESS'
  payload: {
    stepIndex: number
    totalSteps: number
    status: 'starting' | 'waiting' | 'uploading' | 'sending' | 'awaiting_response' | 'delayed' | 'completed' | 'cancelled' | 'error'
    error?: string
  }
}
