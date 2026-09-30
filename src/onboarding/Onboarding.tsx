import { useEffect, useRef, useState } from 'react';
import { FileText, FolderOpen, Plus } from 'lucide-react';
import Logo from '../components/Logo';
import PromptEditor from '../components/PromptEditor';
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
  const [editorOpen, setEditorOpen] = useState(false);
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
      showToast({ variant: 'info', message: 'No Markdown or text files found' });
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
    ignored.empty > 0 ? `${ignored.empty} empty` : '',
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
        <div className="popup-title mt-0">LangQueue</div>
      </header>

      <h1 className="onboarding-title">{importOnly ? 'Import prompts' : 'Set up your library'}</h1>
      {importOnly ? null : <p className="onboarding-lede">Reusable prompts for ChatGPT, Claude, and Gemini.</p>}

      <div className="onboarding-choices">
        <section className="onboarding-card">
          <h2>Import skills or files</h2>
          <p>
            Pick a skills folder like <code>~/.claude/skills</code> or <code>~/.codex/skills</code>, or Markdown files. Each <code>SKILL.md</code> becomes one prompt.
          </p>
          {isMac ? (
            <p>
              Press <kbd>⌘</kbd> <kbd>⇧</kbd> <kbd>.</kbd> in the picker to show hidden folders.
            </p>
          ) : null}
          <div className="onboarding-actions">
            <button className="primary-button" onClick={() => folderInputRef.current?.click()} disabled={reading || importing}>
              <FolderOpen size={15} /> {reading ? 'Reading…' : 'Choose folder'}
            </button>
            <button className="secondary-button" onClick={() => filesInputRef.current?.click()} disabled={reading || importing}>
              <FileText size={15} /> Choose files
            </button>
          </div>
        </section>

        {importOnly ? null : (
          <section className="onboarding-card">
            <h2>Write a prompt</h2>
            <div className="onboarding-actions">
              <button className="primary-button" onClick={() => setEditorOpen(true)}>
                <Plus size={15} /> New prompt
              </button>
            </div>
            {createdTitle ? (
              <div className="onboarding-note">Saved "{createdTitle}". Type $ in a chat to insert it.</div>
            ) : null}
          </section>
        )}
      </div>

      {candidates.length > 0 ? (
        <section className="onboarding-card onboarding-review">
          <div className="review-header">
            <h2>{candidates.length} file{candidates.length === 1 ? '' : 's'} found</h2>
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
            <span className="review-hint">Duplicate titles are skipped.</span>
          </div>
        </section>
      ) : null}

      {summary ? (
        <section className="onboarding-card onboarding-review" role="status">
          <h2>Imported {summary.imported} prompt{summary.imported === 1 ? '' : 's'}</h2>
          {summary.skipped > 0 ? <p>{summary.skipped} skipped as duplicates.</p> : null}
        </section>
      ) : null}

      <footer className="onboarding-hints">
        <span><kbd>{isMac ? '⌘' : 'Ctrl'}</kbd> <kbd>⇧</kbd> <kbd>L</kbd> opens the library</span>
        <span><kbd>$</kbd> in a chat inserts a prompt</span>
        <span>Stored locally in Chrome</span>
      </footer>

      <PromptEditor
        open={editorOpen}
        onClose={() => setEditorOpen(false)}
        onSaved={(saved) => {
          setCreatedTitle(saved.title);
          setEditorOpen(false);
        }}
      />
    </div>
  );
}
