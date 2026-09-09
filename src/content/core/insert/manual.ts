import type { Adapter } from '../../adapters/adapter'
import type { AttachmentRef } from '../../../types'
import type { InsertAndSendPromptResultMessage } from '../../../types/messages'
import { createExecutionCoordinator, getConversationHref } from '../queue/execution'
import { fetchAttachmentFiles } from '../messaging'
import { appendInputText, getInputText, setInputText } from './composer'

export async function insertComposerPrompt(
  adapter: Adapter,
  coordinator: ReturnType<typeof createExecutionCoordinator>,
  content: string,
  attachments: AttachmentRef[],
  mode: 'overwrite' | 'append',
  shouldSend: boolean,
  expectedHref: string,
): Promise<InsertAndSendPromptResultMessage['payload']> {
  if (!content.trim() && attachments.length === 0) return { ok: false, sendAttempted: false, reason: 'This prompt has no text or enabled attachments. Your draft was kept.' }
  if (!coordinator.tryAcquire('manual')) return { ok: false, sendAttempted: false, reason: 'Finish or cancel the current queue or chain before inserting another prompt.' }
  let input: HTMLTextAreaElement | null = null
  let draftChanged = false
  let sendAttempted = false
  function handleDraftChange() { draftChanged = true }
  try {
    input = adapter.getInputElement()
    if (!input) throw new Error('The chat input is unavailable. Return to the conversation and try again.')
    const originalInput = input
    const initialText = getInputText(input)
    function assertComposerUnchanged() {
      if (getConversationHref() !== expectedHref) throw new Error('The conversation changed. Prompt insertion was stopped.')
      if (!originalInput.isConnected || adapter.getInputElement() !== originalInput) throw new Error('The chat input changed. Your draft was kept; try again in the current composer.')
      if (draftChanged || getInputText(originalInput) !== initialText) throw new Error('The composer changed. Your draft was kept; finish editing before trying again.')
      if (shouldSend && adapter.isGenerating()) throw new Error('The model is generating a response. Wait for it to finish before sending another prompt.')
    }
    assertComposerUnchanged()
    input.addEventListener('input', handleDraftChange)
    if (attachments.length) {
      const files = await fetchAttachmentFiles(attachments)
      assertComposerUnchanged()
      const attached = await adapter.attachFiles(files)
      if (!attached.ok) throw new Error(attached.error || 'An attachment could not be uploaded. Check the files in the composer before retrying.')
      const uploaded = await adapter.waitForUploadsComplete({ timeoutMs: 120000, pollMs: 250 })
      assertComposerUnchanged()
      if (!uploaded) throw new Error('Attachment upload timed out. Check the files in the composer before retrying.')
    }
    assertComposerUnchanged()
    input.removeEventListener('input', handleDraftChange)
    if (content) {
      if (mode === 'append') appendInputText(input, content)
      else setInputText(input, content)
    }
    if (shouldSend) {
      if (getConversationHref() !== expectedHref || !input.isConnected || adapter.getInputElement() !== input) throw new Error('The conversation or chat input changed. Sending was stopped.')
      const expectedText = !content ? initialText : mode === 'append' && initialText ? `${initialText}\n${content}` : content
      const expectedInputText = expectedText.replace(/\r\n|\r/g, '\n')
      if (getInputText(input) !== expectedInputText) throw new Error('The composer changed during insertion. Check your draft before sending.')
      if (adapter.isGenerating()) throw new Error('The model started generating a response. Check the composer before sending again.')
      sendAttempted = true
      if (!adapter.clickSend(input)) {
        sendAttempted = false
        throw new Error('The send button is unavailable. Your prompt remains in the composer.')
      }
    }
    return { ok: true, sendAttempted }
  } catch (cause) {
    return { ok: false, sendAttempted, reason: cause instanceof Error ? cause.message : 'Prompt insertion failed. Check the composer before trying again.' }
  } finally {
    input?.removeEventListener('input', handleDraftChange)
    coordinator.release()
  }
}
