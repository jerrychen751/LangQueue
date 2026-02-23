import styles from './editor.css?raw';
import trashSvg from './trash.svg?raw';

export type PromptDraft = {
  id?: string;
  title: string;
  content: string;
};

/**
 * Builds the DOM tree for the modal editor. Returns a JS object with 3 properties/functions to manage the visibility of the modal editor.
 * 
 * All DOM construction, UI logic, input validation, and event handling is self-contained.
 * 
 * Callback functions are passed in upon creation of editor (logic injected at call site).
 */
export function createEditor(callbacks: {
  onSave: (draft: PromptDraft) => Promise<boolean> | boolean;
  onDelete: (id: string) => Promise<boolean> | boolean;
  onClose?: () => void;
}) {
  // Build elements of DOM/HTML for modal editor
  const host = document.createElement('div');
  host.setAttribute('data-langqueue-editor', 'true');
  const shadow = host.attachShadow({ mode: 'open' });
  const sheet = new CSSStyleSheet();
  sheet.replaceSync(styles);

  const backdrop = document.createElement('div');
  backdrop.className = 'backdrop';
  const modal = document.createElement('div');
  modal.className = 'modal';

  const header = document.createElement('div');
  header.className = 'header';
  const title = document.createElement('div');
  title.className = 'title';
  title.textContent = 'Edit Shortcut';
  const closeBtn = document.createElement('button');
  closeBtn.className = 'close';
  closeBtn.innerHTML = '&times;';
  header.append(title, closeBtn);

  const body = document.createElement('div');
  body.className = 'body';
  const nameLabel = document.createElement('label');
  nameLabel.className = 'label';
  nameLabel.textContent = 'Shortcut name';
  const nameInput = document.createElement('input');
  nameInput.className = 'input';
  nameInput.placeholder = 'e.g., draft-email';

  const instructionsLabel = document.createElement('label');
  instructionsLabel.className = 'label';
  instructionsLabel.textContent = 'Instructions';
  const instructionsArea = document.createElement('textarea');
  instructionsArea.className = 'textarea';
  instructionsArea.placeholder = 'Write the prompt instructions here';

  const errorEl = document.createElement('div');
  errorEl.className = 'error';
  const shortcutHintEl = document.createElement('div');
  shortcutHintEl.className = 'hint';
  const isMac = navigator.userAgent.toLowerCase().includes('mac');
  shortcutHintEl.textContent = isMac ? '⌘ + Enter to save' : 'Ctrl + Enter to save';

  body.append(nameLabel, nameInput, instructionsLabel, instructionsArea, errorEl, shortcutHintEl);

  const footer = document.createElement('div');
  footer.className = 'footer';
  const deleteBtn = document.createElement('button');
  deleteBtn.className = 'delete';
  deleteBtn.innerHTML = trashSvg;
  const cancelBtn = document.createElement('button');
  cancelBtn.className = 'btn btn-secondary';
  cancelBtn.textContent = 'Cancel';
  const saveBtn = document.createElement('button');
  saveBtn.className = 'btn btn-primary';
  saveBtn.textContent = 'Save';
  footer.append(deleteBtn, cancelBtn, saveBtn);

  modal.append(header, body, footer);
  backdrop.append(modal);
  shadow.append(backdrop);
  shadow.adoptedStyleSheets = [sheet];
  document.documentElement.append(host);

  // Track internal state for UI logic (e.g., invalidate certain buttons during save operations)
  let activePromptId: string | undefined;
  let isOpen = false; // allow check for events depending on visibility of modal editor (i.e., `esc` shouldn't do anything if editor not open)
  let busy = false; // guarantee one op at a time
  let lastFocused: HTMLElement | null = null; // restore focus to element after modal editor is closed

  function setBusy(next: boolean) {
    busy = next;
    saveBtn.disabled = next;
    cancelBtn.disabled = next;
    deleteBtn.disabled = next;
  }

  function setError(message: string) {
    errorEl.textContent = message;
  }

  function resetError() {
    setError('');
  }

  // Logic for controlling UI view
  function open(draft: PromptDraft) {
    lastFocused = document.activeElement as HTMLElement | null;
    activePromptId = draft.id;
    nameInput.value = draft.title || '';
    instructionsArea.value = draft.content || '';
    resetError();
    deleteBtn.style.display = activePromptId ? 'inline-flex' : 'none';
    backdrop.style.display = 'flex';
    isOpen = true;
    setTimeout(() => nameInput.focus(), 0);
  }

  function close() {
    backdrop.style.display = 'none';
    isOpen = false;
    callbacks.onClose?.();
    if (lastFocused) {
      setTimeout(() => lastFocused?.focus(), 0);
    }
  }

  async function handleSave() {
    if (busy) return;
    const titleVal = nameInput.value.trim();
    const rawContent = instructionsArea.value;
    const trimmedContent = rawContent.trim();
    if (!titleVal) {
      setError('Shortcut name is required.');
      nameInput.focus();
      return;
    }
    if (!trimmedContent) {
      setError('Instructions are required.');
      instructionsArea.focus();
      return;
    }
    resetError();
    setBusy(true);
    try {
      const ok = await callbacks.onSave({ id: activePromptId, title: titleVal, content: rawContent });
      if (ok) {
        close();
      } else {
        setError('Failed to save.');
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to save.';
      setError(message);
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete() {
    if (busy || !activePromptId) return;
    setBusy(true);
    try {
      const ok = await callbacks.onDelete(activePromptId);
      if (ok) {
        close();
      } else {
        setError('Failed to delete.');
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to delete.';
      setError(message);
    } finally {
      setBusy(false);
    }
  }

  function handleKeydown(event: KeyboardEvent) {
    if (!isOpen) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
    }

    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      void handleSave();
    }
  }

  closeBtn.addEventListener('click', () => close());
  cancelBtn.addEventListener('click', () => close());
  saveBtn.addEventListener('click', () => void handleSave());
  deleteBtn.addEventListener('click', () => void handleDelete());
  backdrop.addEventListener('mousedown', (event) => {
    if (event.target === backdrop) close();
  });
  document.addEventListener('keydown', handleKeydown, true);

  return {
    open: open,
    close: close,
    isOpen: () => isOpen,
  };
}
