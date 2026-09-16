import type { AttachmentRef, Platform } from '../library/model';
import { callBackground } from '../messaging/requests';

export async function getSettings() {
  return callBackground('GET_SETTINGS', undefined);
}

export async function searchPrompts(query: string, limit?: number) {
  return callBackground('PROMPT_SEARCH', { query, limit });
}

export async function searchChains(query: string, limit?: number) {
  return callBackground('CHAIN_SEARCH', { query, limit });
}

export async function logUsage(promptId: string, platform: Platform) {
  try {
    await callBackground('LOG_USAGE', { promptId, platform });
  } catch (error) {
    // Report logging failure without retrying the prompt
    throw new Error(error instanceof Error ? error.message : 'Usage could not be saved.');
  }
}

export async function openPromptEditor(promptId: string) {
  try {
    await callBackground('OPEN_PROMPT_EDITOR', { promptId });
  } catch {
    // no-op
  }
}

export async function updatePrompt(id: string, title: string, content: string, attachments?: AttachmentRef[]): Promise<boolean> {
  try {
    await callBackground('PROMPT_UPDATE', { id, title, content, attachments });
    return true;
  } catch (err) {
    if (err instanceof Error) {
      throw err;
    }
    throw new Error('Failed to save.');
  }
}

export async function deletePrompt(id: string): Promise<boolean> {
  try {
    await callBackground('PROMPT_DELETE', { id });
    return true;
  } catch {
    return false;
  }
}

export async function createPrompt(title: string, content: string, attachments?: AttachmentRef[]): Promise<boolean> {
  try {
    await callBackground('PROMPT_CREATE', { title, content, attachments });
    return true;
  } catch (err) {
    if (err instanceof Error) {
      throw err;
    }
    throw new Error('Failed to save.');
  }
}

export async function getAttachmentMetas(ids: string[]): Promise<{ attachments: AttachmentRef[]; missingIds: string[] }> {
  if (!Array.isArray(ids) || ids.length === 0) {
    return { attachments: [], missingIds: [] };
  }
  try {
    return await callBackground('ATTACHMENT_GET_META', { ids });
  } catch {
    return { attachments: [], missingIds: ids };
  }
}

export async function fetchAttachmentFiles(attachments: AttachmentRef[]): Promise<File[]> {
  if (!Array.isArray(attachments) || attachments.length === 0) {
    return [];
  }
  const files: File[] = [];
  for (const attachment of attachments) {
    let offset = 0;
    const chunks: string[] = [];
    let totalBytes = 0;
    let done = false;
    while (!done) {
      const chunk = await callBackground('ATTACHMENT_GET_CHUNK', { id: attachment.id, offset, length: 64 * 1024 });
      chunks.push(chunk.chunkBase64);
      offset = chunk.nextOffset;
      totalBytes = chunk.totalBytes;
      done = chunk.done;
    }
    const bytes = decodeBase64Chunks(chunks, totalBytes);
    files.push(new File([bytes], attachment.name, { type: attachment.mimeType }));
  }
  return files;
}

function decodeBase64Chunks(chunks: string[], totalBytes: number): ArrayBuffer {
  const out = new Uint8Array(Math.max(0, totalBytes));
  let cursor = 0;
  for (const chunk of chunks) {
    if (!chunk) {
      continue;
    }
    const binary = atob(chunk);
    for (let i = 0; i < binary.length; i += 1) {
      if (cursor >= out.length) {
        break;
      }
      out[cursor] = binary.charCodeAt(i);
      cursor += 1;
    }
  }
  return out.buffer.slice(0, cursor);
}
