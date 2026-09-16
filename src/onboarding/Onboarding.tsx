import { useEffect, useRef, useState } from 'react';
import { FileText, FolderOpen, Plus } from 'lucide-react';
import Logo from '../components/Logo';
import PromptModal from '../components/PromptModal';
import { useToast } from '../components/useToast';
import { importPromptDrafts } from '../library/storage';
import { findSkillSupportPaths, isPromptFilePath, parsePromptFile, type ParsedPromptFile } from '../library/promptFiles';

export default function Onboarding() {
  const [importOnly, setImportOnly] = useState(() => window.location.hash === '#import');
  const isMac = navigator.platform.includes('Mac');
  const folderInputRef = useRef<HTMLInputElement | null>(null);
  const filesInputRef = useRef<HTMLInputElement | null>(null);
  const [candidates, setCandidates] = useState<ParsedPromptFile[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [ignored, setIgnored] = useState({ support: 0, unsupported: 0, empty: 0 });
  const [reading, setReading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [summary, setSummary] = useState<{ imported: number; skipped: number } | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [createdTitle, setCreatedTitle] = useState<string | null>(null);
  const { showToast } = useToast();

  useEffect(() => {
    folderInputRef.current?.setAttribute('webkitdirectory', '');
    const syncHash = () => setImportOnly(window.location.hash === '#import');
    window.addEventListener('hashchange', syncHash);
    return () => window.removeEventListener('hashchange', syncHash);
  }, []);

  async function handleFilesPicked(list: FileList | null) {
    if (!list || list.length === 0) {
      return;
    }
    setReading(true);
    setSummary(null);
    const files = Array.from(list);
    const support = findSkillSupportPaths(files.map((file) => file.webkitRelativePath || file.name));
    const parsed: ParsedPromptFile[] = [];
    let unsupported = 0;
    let empty = 0;
    try {
      for (const file of files) {
        const path = file.webkitRelativePath || file.name;
        if (support.has(path)) {
          continue;
        }
        if (!isPromptFilePath(path) || file.size > 1024 * 1024) {
          unsupported += 1;
          continue;
        }
        const candidate = parsePromptFile(path, await file.text());
        if (!candidate) {
          empty += 1;
          continue;
        }
        parsed.push(candidate);
      }
    } catch (error) {
      showToast({ variant: 'error', message: error instanceof Error ? error.message : 'Files could not be read' });
    } finally {
      if (folderInputRef.current) {
        folderInputRef.current.value = '';
      }
      if (filesInputRef.current) {
        filesInputRef.current.value = '';
      }
      setReading(false);
    }
    parsed.sort((a, b) => a.path.localeCompare(b.path));
    setCandidates(parsed);
    setSelected(new Set(parsed.filter((candidate) => candidate.suggested).map((candidate) => candidate.path)));
    setIgnored({ support: support.size, unsupported, empty });
    if (parsed.length === 0) {
      showToast({ variant: 'info', message: 'No Markdown or text prompt files in that selection' });
    }
  }

  function toggle(path: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  }

  async function handleImport() {
    const drafts = candidates.filter((candidate) => selected.has(candidate.path));
    if (drafts.length === 0 || importing) {
      return;
    }
    setImporting(true);
    try {
      const result = await importPromptDrafts(drafts);
      setSummary(result);
      setCandidates([]);
      setSelected(new Set());
      chrome.runtime.sendMessage({ type: 'PROMPTS_IMPORTED' }).catch(() => {});
    } catch (error) {
      showToast({ variant: 'error', message: error instanceof Error ? error.message : 'Import failed' });
    } finally {
      setImporting(false);
    }
  }

  const ignoredParts = [
    ignored.support > 0 ? `${ignored.support} skill support file${ignored.support === 1 ? '' : 's'}` : '',
    ignored.unsupported > 0 ? `${ignored.unsupported} hidden or unsupported file${ignored.unsupported === 1 ? '' : 's'}` : '',
    ignored.empty > 0 ? `${ignored.empty} without prompt text` : '',
  ].filter(Boolean);
  const selectedCount = selected.size;

  return (
    <div className="onboarding-page">
      <input ref={folderInputRef} type="file" multiple className="hidden" onChange={(e) => void handleFilesPicked(e.target.files)} />
      <input ref={filesInputRef} type="file" multiple accept=".md,.markdown,.txt" className="hidden" onChange={(e) => void handleFilesPicked(e.target.files)} />

      <header className="onboarding-header">
        <div className="logo-frame">
          <Logo size={22} ariaLabel="LangQueue" />
        </div>
        <div>
          <div className="popup-kicker">{importOnly ? 'Library import' : 'Welcome'}</div>
          <div className="popup-title">LangQueue</div>
        </div>
      </header>

      <h1 className="onboarding-title">{importOnly ? 'Import prompts from files' : 'Set up your prompt library'}</h1>
      <p className="onboarding-lede">
        {importOnly
          ? 'Pick Markdown or text files and each one becomes a prompt in your library.'
          : 'LangQueue keeps reusable prompts in local Chrome storage and inserts them into ChatGPT, Claude, and Gemini. Start with the prompts you already have, or write a new one.'}
      </p>

      <div className="onboarding-choices">
        <section className="onboarding-card">
          <div className="popup-kicker">Import</div>
          <h2>Import from Claude or ChatGPT skills</h2>
          <p>
            Choose a skills folder such as <code>~/.claude/skills</code> from Claude Code or <code>~/.codex/skills</code> from Codex and ChatGPT, or pick individual Markdown prompt files. Each skill's <code>SKILL.md</code> becomes one prompt, titled from its frontmatter <code>name</code>, and its scripts and reference files are left out.
          </p>
          {isMac ? (
            <p>
              Hidden folders such as <code>.claude</code> appear in the picker after you press <kbd>⌘</kbd> <kbd>⇧</kbd> <kbd>.</kbd>
            </p>
          ) : null}
          <div className="onboarding-actions">
            <button className="primary-button" onClick={() => folderInputRef.current?.click()} disabled={reading || importing}>
              <FolderOpen size={15} /> {reading ? 'Reading files…' : 'Choose a folder'}
            </button>
            <button className="secondary-button" onClick={() => filesInputRef.current?.click()} disabled={reading || importing}>
              <FileText size={15} /> Choose files
            </button>
          </div>
        </section>

        {importOnly ? null : (
          <section className="onboarding-card">
            <div className="popup-kicker">Create</div>
            <h2>Write your first prompt</h2>
            <p>
              Save a prompt once. Insert it later from the toolbar popup, or type <code>$</code> in a supported chat to search your library.
            </p>
            <div className="onboarding-actions">
              <button className="primary-button" onClick={() => setModalOpen(true)}>
                <Plus size={15} /> New prompt
              </button>
            </div>
            {createdTitle ? (
              <div className="onboarding-note">Saved "{createdTitle}". Open ChatGPT, Claude, or Gemini and type $ to insert it.</div>
            ) : null}
          </section>
        )}
      </div>

      {candidates.length > 0 ? (
        <section className="onboarding-card onboarding-review">
          <div className="review-header">
            <div>
              <div className="popup-kicker">Review</div>
              <h2>{candidates.length} file{candidates.length === 1 ? '' : 's'} ready</h2>
            </div>
            <div className="review-tools">
              <button className="compact-button" onClick={() => setSelected(new Set(candidates.map((candidate) => candidate.path)))}>Select all</button>
              <button className="compact-button" onClick={() => setSelected(new Set())}>Select none</button>
            </div>
          </div>
          <ul className="review-list">
            {candidates.map((candidate) => (
              <li key={candidate.path}>
                <label className="review-row">
                  <input type="checkbox" checked={selected.has(candidate.path)} onChange={() => toggle(candidate.path)} />
                  <div className="min-w-0">
                    <div className="review-title">{candidate.title}</div>
                    <div className="review-path">{candidate.path}</div>
                  </div>
                  <div className="review-preview">{candidate.content.slice(0, 240)}</div>
                </label>
              </li>
            ))}
          </ul>
          {ignoredParts.length > 0 ? <p className="review-ignored">Left out: {ignoredParts.join(', ')}.</p> : null}
          <div className="review-footer">
            <button className="primary-button" onClick={handleImport} disabled={selectedCount === 0 || importing}>
              {importing ? 'Importing…' : `Import ${selectedCount} prompt${selectedCount === 1 ? '' : 's'}`}
            </button>
            <button className="secondary-button" onClick={() => { setCandidates([]); setSelected(new Set()); }} disabled={importing}>
              Cancel
            </button>
            <span className="review-hint">A file whose title already exists in the library is skipped.</span>
          </div>
        </section>
      ) : null}

      {summary ? (
        <section className="onboarding-card onboarding-review" role="status">
          <div className="popup-kicker">Done</div>
          <h2>Imported {summary.imported} prompt{summary.imported === 1 ? '' : 's'}</h2>
          <p>
            {summary.skipped > 0 ? `${summary.skipped} skipped because the library already has a prompt with that title. ` : ''}
            Open ChatGPT, Claude, or Gemini and type <code>$</code> to insert one, or open the toolbar popup to browse the library.
          </p>
        </section>
      ) : null}

      <footer className="onboarding-hints">
        <span><kbd>{isMac ? '⌘' : 'Ctrl'}</kbd> <kbd>⇧</kbd> <kbd>L</kbd> opens the library</span>
        <span><kbd>$</kbd> in a chat searches your prompts</span>
        <span>Everything stays in local Chrome storage</span>
      </footer>

      <PromptModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onSaved={(saved) => {
          setCreatedTitle(saved.title);
          setModalOpen(false);
        }}
      />
    </div>
  );
}
