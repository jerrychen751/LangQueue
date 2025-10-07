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

export type KnownMessage =
  | InjectPromptMessage
  | TextareaReadyMessage
  | OpenPopupMessage
  | CompatCheckMessage
  | CompatStatusMessage
  | InjectPromptResultMessage
  | InjectPromptErrorMessage


