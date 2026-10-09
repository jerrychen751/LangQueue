import { Adapter } from './adapter';
import {
  findEnabledFileInput,
  findComposerSendButton,
  isVisible,
  setFilesOnInput,
} from './page_dom';

// ChatGPT renames a repeated upload in one conversation from `notes.txt` to `notes(1).txt`
function removeDuplicateSuffix(name: string) {
  return name.replace(/\(\d+\)(?=\.[^.]*$|$)/, '');
}

class ChatGPTAdapter extends Adapter {
  id = 'chatgpt' as const;
  private uploadAttempt: { input: HTMLTextAreaElement; form: Element; href: string; files: File[]; counts: Map<string, number> } | null = null;

  matchesAdapterDomain(): boolean {
    return /chatgpt\.com|chat\.openai\.com/.test(window.location.hostname);
  }

  getInputElement(): HTMLTextAreaElement | null {
    // ChatGPT uses a contenteditable div as its primary input
    const ceSelectors = [
      'div[contenteditable="true"][role="textbox"]',
      'div[contenteditable="true"][data-testid*="prompt" i]',
      'div[contenteditable="true"]',
    ];
    for (const sel of ceSelectors) {
      const els = Array.from(document.querySelectorAll(sel)) as HTMLElement[];
      const found = els.find((n) => isVisible(n));
      if (found) {
        return found as unknown as HTMLTextAreaElement;
      }
    }

    // Fallback: known textarea by id
    const byId = document.getElementById('prompt-textarea');
    if (byId && byId.tagName === 'TEXTAREA' && isVisible(byId)) {
      return byId as HTMLTextAreaElement;
    }

    // Fallback: visible textarea within a form
    const withinForm = Array.from(
      document.querySelectorAll('form textarea:not([readonly]):not([disabled]):not([class*="fallbackTextarea"])')
    ) as HTMLElement[];
    const ta1 = withinForm.find((el) => el.tagName === 'TEXTAREA' && isVisible(el));
    if (ta1) {
      return ta1 as HTMLTextAreaElement;
    }

    // Last resort: any visible textarea
    const anyTextarea = Array.from(document.querySelectorAll('textarea')) as HTMLElement[];
    const ta2 = anyTextarea.find((el) => el.tagName === 'TEXTAREA' && isVisible(el));
    if (ta2) {
      return ta2 as HTMLTextAreaElement;
    }

    return null;
  }

  isGenerating(): boolean {
    // Stop button replaces send button during streaming — only exists in the DOM while generating
    if (document.querySelector('button[data-testid="stop-button"]')) {
      return true;
    }
    if (document.querySelector('button[aria-label="Stop streaming"]')) {
      return true;
    }

    // Active response's markdown container gets this class while streaming
    if (document.querySelector('.streaming-animation')) {
      return true;
    }

    // The composer's submit button becomes a Stop button without a test id while streaming
    if (this.getInputElement()?.closest('form')?.querySelector('button[aria-label="Stop"]')) {
      return true;
    }

    // A draft typed while the model thinks turns the Stop button back into Send; the response then shows only as a busy status line until its turn exists, and as an unfinished turn after that
    if (document.querySelector('[role="status"][aria-busy="true"], [data-talvt-turn-state="in_progress"]')) {
      return true;
    }

    return false;
  }

  getSendButton(input?: HTMLTextAreaElement | null): HTMLButtonElement | null {
    const target = input || this.getInputElement();
    if (!target) {
      return null;
    }

    return findComposerSendButton(target, [
      'button#composer-submit-button',
      'button.composer-submit-btn',
      'button[data-testid="send-button"]',
      'button[aria-label="Send message"]',
      'button[aria-label="Send"]',
    ]);
  }

  clickSend(input?: HTMLTextAreaElement | null): boolean {
    const candidate = this.getSendButton(input);
    if (!candidate) {
      return false;
    }
    try {
      candidate.click();
      return true;
    } catch {
      // Preserve uncertainty after an attempted click
      throw new Error('The send click may have been attempted. Check the conversation before sending again.');
    }
  }

  async attachFiles(files: File[]) {
    this.uploadAttempt = null;
    if (!Array.isArray(files) || files.length === 0) {
      return { ok: true };
    }
    const composer = this.getInputElement();
    // The composer also holds photo-only inputs, so pick the one that accepts every file type
    const input = findEnabledFileInput(composer, ['input[type="file"][aria-label="Attach files"]']);
    if (!input) {
      return { ok: false, error: 'A safe chat uploader was not found. Attach the files manually in the chat composer; automatic upload is unavailable.' };
    }
    const form = composer?.closest('form[data-chatgpt-composer]');
    if (!composer || !form) {
      return { ok: false, error: 'Attachment acceptance cannot be checked in this chat layout. Attach the files manually in the chat composer.' };
    }
    const counts = new Map<string, number>();
    for (const remove of form.querySelectorAll('button[aria-label^="Remove "]')) {
      const name = removeDuplicateSuffix(remove.getAttribute('aria-label')!.slice('Remove '.length));
      counts.set(name, (counts.get(name) || 0) + 1);
    }
    this.uploadAttempt = { input: composer, form, href: location.href, files: [...files], counts };
    const result = setFilesOnInput(input, files);
    if (!result.ok) {
      this.uploadAttempt = null;
    }
    return result;
  }

  async waitForUploadsComplete(options?: { timeoutMs?: number; pollMs?: number; files?: File[] }): Promise<boolean> {
    const attempt = this.uploadAttempt;
    const files = options?.files;
    if (!attempt || !files?.length || files.length !== attempt.files.length || files.some((file, index) => file !== attempt.files[index])) {
      return false;
    }
    const expected = new Map(attempt.counts);
    for (const file of files) {
      const name = removeDuplicateSuffix(file.name);
      expected.set(name, (expected.get(name) || 0) + 1);
    }
    const started = Date.now();
    while (Date.now() - started < (options?.timeoutMs ?? 60000)) {
      if (this.uploadAttempt !== attempt || location.href !== attempt.href || !attempt.form.isConnected || !attempt.input.isConnected || this.getInputElement() !== attempt.input || attempt.input.closest('form[data-chatgpt-composer]') !== attempt.form) {
        if (this.uploadAttempt === attempt) {
          this.uploadAttempt = null;
        }
        return false;
      }
      const accepted = new Map<string, number>();
      for (const remove of attempt.form.querySelectorAll('button[aria-label^="Remove "]')) {
        const tile = remove.parentElement;
        if (!tile?.getClientRects().length) {
          continue;
        }
        const name = remove.getAttribute('aria-label')!.slice('Remove '.length);
        // A rejected file keeps its Remove button and error text but loses the preview surface labeled with its name
        const hasPreview = [tile, ...tile.querySelectorAll('[aria-label]')].some(node => node.getAttribute('aria-label') === name && node.getClientRects().length > 0);
        const imagesLoaded = Array.from(tile.querySelectorAll<HTMLImageElement>('img')).every(image => image.complete && image.naturalWidth > 0 && image.naturalHeight > 0);
        if (!hasPreview || !imagesLoaded) {
          continue;
        }
        const baseName = removeDuplicateSuffix(name);
        accepted.set(baseName, (accepted.get(baseName) || 0) + 1);
      }
      const busy = Array.from(attempt.form.querySelectorAll('[aria-busy="true"], [aria-label*="Uploading" i], [class*="animate-spin"], [class*="upload" i][class*="progress" i]')).some(node => node.getClientRects().length > 0);
      if (files.every(file => (accepted.get(removeDuplicateSuffix(file.name)) || 0) >= expected.get(removeDuplicateSuffix(file.name))!) && !busy && this.getSendButton(attempt.input)) {
        this.uploadAttempt = null;
        return true;
      }
      await new Promise(resolve => setTimeout(resolve, options?.pollMs ?? 200));
    }
    if (this.uploadAttempt === attempt) {
      this.uploadAttempt = null;
    }
    return false;
  }

}

export function createChatGPTAdapter(): Adapter {
  return new ChatGPTAdapter();
}
