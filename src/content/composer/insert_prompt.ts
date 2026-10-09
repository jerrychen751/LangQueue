import type { Adapter } from '../adapters/adapter';
import type { AttachmentRef } from '../../library/model';
import type { InsertPromptResult } from '../../messaging/request_types';
import { createExecutionCoordinator, getConversationHref, sendPromptWhenReady } from '../execution/step_execution';
import { fetchAttachmentFiles } from '../library_requests';
import { appendInputText, getInputText, setInputText } from './composer_text';

export async function insertComposerPrompt(
  adapter: Adapter,
  coordinator: ReturnType<typeof createExecutionCoordinator>,
  content: string,
  attachments: AttachmentRef[],
  mode: 'overwrite' | 'append',
  shouldSend: boolean,
  expectedHref: string,
): Promise<InsertPromptResult> {
  if (!content.trim() && attachments.length === 0) {
    return { ok: false, sendAttempted: false, reason: 'This prompt has no text to insert. If it only has files, turn on Attachments in Settings.' };
  }
  if (!coordinator.tryAcquire('manual')) {
    return { ok: false, sendAttempted: false, reason: 'A queue or chain is running. Wait for it or cancel it first.' };
  }
  let input: HTMLTextAreaElement | null = null;
  let draftChanged = false;
  let sendAttempted = false;
  function handleDraftChange() { draftChanged = true; }
  try {
    input = adapter.getInputElement();
    if (!input) {
      throw new Error('Couldn\'t find the chat box. Open a chat and try again.');
    }
    const originalInput = input;
    const initialText = getInputText(input);
    function assertComposerUnchanged() {
      if (getConversationHref() !== expectedHref) {
        throw new Error('You switched chats, so nothing was inserted.');
      }
      if (!originalInput.isConnected || adapter.getInputElement() !== originalInput) {
        throw new Error('The chat box reloaded, so nothing was inserted. Try again.');
      }
      if (draftChanged || getInputText(originalInput) !== initialText) {
        throw new Error('Your draft changed, so nothing was inserted. Try again.');
      }
      if (shouldSend && adapter.isGenerating()) {
        throw new Error('Wait for the response to finish, then send.');
      }
    }
    assertComposerUnchanged();
    input.addEventListener('input', handleDraftChange);
    if (attachments.length) {
      const files = await fetchAttachmentFiles(attachments);
      assertComposerUnchanged();
      const attached = await adapter.attachFiles(files);
      if (!attached.ok) {
        throw new Error(attached.error || 'A file didn\'t upload. Check the files in the chat box, then try again.');
      }
      const uploaded = await adapter.waitForUploadsComplete({ timeoutMs: 120000, pollMs: 250, files });
      assertComposerUnchanged();
      if (!uploaded) {
        throw new Error('Couldn\'t confirm the upload. Check the files in the chat box, then try again.');
      }
    }
    assertComposerUnchanged();
    input.removeEventListener('input', handleDraftChange);
    if (mode === 'append') {
      if (content) {
        appendInputText(input, content);
      }
    } else {
      setInputText(input, content);
    }
    if (shouldSend) {
      const expectedText = mode === 'append' ? !content ? initialText : initialText ? `${initialText}\n${content}` : content : content;
      const expectedInputText = expectedText.replace(/\r\n|\r/g, '\n');
      await sendPromptWhenReady(adapter, input, expectedInputText, expectedHref, () => { sendAttempted = true; });
    }
    return { ok: true, sendAttempted };
  } catch (cause) {
    if (cause instanceof Error && cause.message === 'SEND_FAILED') {
      return { ok: false, sendAttempted: false, reason: 'Couldn\'t press Send. Your prompt is in the chat box.' };
    }
    const message = cause instanceof Error ? cause.message : '';
    const reason = message.startsWith('CONVERSATION_CHANGED') ? 'You switched chats before the prompt was sent.'
      : message.startsWith('COMPOSER_CHANGED') ? 'The chat box changed before the prompt was sent. Check it, then send it yourself.'
      : message === 'ATTACHMENT_NOT_FOUND' ? 'A file saved with this prompt is missing. Add it to the prompt again.'
      : message || 'Couldn\'t insert the prompt.';
    return { ok: false, sendAttempted, reason };
  } finally {
    input?.removeEventListener('input', handleDraftChange);
    coordinator.release();
  }
}
