import type {
  AttachmentExportRecord,
  AttachmentRef,
  AppSettings,
  ChainExportFile,
  ChainsEnvelope,
  DuplicateStrategy,
  ImportMode,
  LibraryExportFile,
  Prompt,
  PromptExportFile,
  PromptsSchema,
  PromptChain,
  PromptStep,
  UsageLog,
  UsageSchema,
} from '../types';
import { CURRENT_CHAINS_SCHEMA_VERSION, CURRENT_SCHEMA_VERSION } from '../types';
import {
  deleteAttachment,
  exportAttachmentRecords,
  importAttachmentRecords,
  inferAttachmentKind,
  listAttachmentMetas,
} from './attachments';

// Chrome local storage API
async function getFromLocalStorage<T>(key: string): Promise<T | undefined> {
  const result = await chrome.storage.local.get([key]);
  return result[key] as T | undefined;
}

async function setInLocalStorage<T>(key: string, value: T): Promise<void> {
  await chrome.storage.local.set({ [key]: value });
}

async function removeFromLocalStorage(key: string): Promise<void> {
  await chrome.storage.local.remove([key]);
}


const PROMPTS_KEY = 'langqueue_prompts';
const CHAINS_KEY = 'langqueue_chains';
const SETTINGS_KEY = 'langqueue_settings';
const USAGE_KEY = 'langqueue_usage';

function safeNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function normalizeAttachmentRefs(raw: unknown): AttachmentRef[] {
  if (!Array.isArray(raw)) return [];
  const out: AttachmentRef[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue;
    const candidate = entry as Partial<AttachmentRef>;
    if (typeof candidate.id !== 'string' || typeof candidate.name !== 'string' || typeof candidate.mimeType !== 'string') continue;
    const size = safeNumber(candidate.size, 0);
    if (size <= 0) continue;
    const kind = candidate.kind === 'image' || candidate.kind === 'file'
      ? candidate.kind
      : inferAttachmentKind(candidate.mimeType);
    out.push({
      id: candidate.id,
      name: candidate.name,
      mimeType: candidate.mimeType,
      size,
      kind,
      createdAt: safeNumber(candidate.createdAt, Date.now()),
    });
  }
  return out;
}

function normalizePrompt(raw: unknown): Prompt | null {
  if (!raw || typeof raw !== 'object') return null;
  const candidate = raw as Partial<Prompt>;
  if (typeof candidate.id !== 'string') return null;
  if (typeof candidate.title !== 'string') return null;
  if (typeof candidate.content !== 'string') return null;
  const ts = Date.now();
  return {
    id: candidate.id,
    title: candidate.title,
    content: candidate.content,
    attachments: normalizeAttachmentRefs(candidate.attachments),
    usageCount: safeNumber(candidate.usageCount, 0),
    createdAt: safeNumber(candidate.createdAt, ts),
    updatedAt: safeNumber(candidate.updatedAt, ts),
    lastUsedAt: typeof candidate.lastUsedAt === 'number' ? candidate.lastUsedAt : undefined,
  };
}

function getDefaultPrompts(timestamp: number): Prompt[] {
  const templates = [
    {
      title: 'summarize-in-bullets',
      content: 'Summarize the above in 5 concise bullets. Highlight key decisions and next steps.',
    },
    {
      title: 'rewrite-for-clarity',
      content: 'Rewrite the above for clarity and brevity. Keep the original meaning.',
    },
    {
      title: 'extract-action-items',
      content: 'Extract the action items from the above. Return a concise checklist.',
    },
    {
      title: 'explain-simply',
      content: 'Explain the above in simple terms for a beginner. Use a short example.',
    },
    {
      title: 'draft-a-reply',
      content: 'Draft a concise, professional reply to the above. Provide 2 variations.',
    },
  ];
  return templates.map((item, index) => ({
    id: generateId('p'),
    title: item.title,
    content: item.content,
    attachments: [],
    usageCount: 0,
    createdAt: timestamp - index,
    updatedAt: timestamp - index,
  }));
}

function createEmptyPrompts(): PromptsSchema {
  const ts = Date.now();
  const defaults = getDefaultPrompts(ts);
  const promptsById = Object.fromEntries(defaults.map((prompt) => [prompt.id, prompt]));
  return {
    meta: { schemaVersion: CURRENT_SCHEMA_VERSION, createdAt: ts, updatedAt: ts },
    promptsById,
  };
}

function createEmptyUsage(): UsageSchema {
  return { totalUses: 0, logs: [] };
}

function createEmptyChainsEnvelope(): ChainsEnvelope {
  return {
    version: CURRENT_CHAINS_SCHEMA_VERSION,
    updatedAt: Date.now(),
    items: [],
  };
}

function normalizeChainStep(raw: unknown): PromptStep {
  if (typeof raw === 'string') {
    return { content: raw, attachments: [] };
  }
  if (!raw || typeof raw !== 'object') {
    return { content: '', attachments: [] };
  }
  const candidate = raw as Partial<PromptStep>;
  return {
    content: typeof candidate.content === 'string' ? candidate.content : '',
    attachments: normalizeAttachmentRefs(candidate.attachments),
  };
}

function normalizeChain(raw: unknown): PromptChain | null {
  if (!raw || typeof raw !== 'object') return null;
  const candidate = raw as Partial<PromptChain>;
  if (typeof candidate.id !== 'string') return null;
  if (typeof candidate.title !== 'string') return null;
  const ts = Date.now();
  const stepsRaw = Array.isArray(candidate.steps) ? candidate.steps : [];
  return {
    id: candidate.id,
    title: candidate.title,
    description: typeof candidate.description === 'string' ? candidate.description : undefined,
    steps: stepsRaw.map((step) => normalizeChainStep(step)),
    createdAt: safeNumber(candidate.createdAt, ts),
    updatedAt: safeNumber(candidate.updatedAt, ts),
  };
}

async function getPrompts(): Promise<PromptsSchema> {
  const existing = await getFromLocalStorage<PromptsSchema>(PROMPTS_KEY);
  if (!existing) {
    const prompts = createEmptyPrompts();
    await setInLocalStorage(PROMPTS_KEY, prompts);
    return prompts;
  }
  return existing;
}

async function savePrompts(schema: PromptsSchema): Promise<void> {
  schema.meta.updatedAt = Date.now();
  await setInLocalStorage(PROMPTS_KEY, schema);
}

async function getUsage(): Promise<UsageSchema> {
  const existing = await getFromLocalStorage<UsageSchema>(USAGE_KEY);
  if (!existing) {
    const usage = createEmptyUsage();
    await setInLocalStorage(USAGE_KEY, usage);
    return usage;
  }
  return existing;
}

async function saveUsage(usage: UsageSchema): Promise<void> {
  await setInLocalStorage(USAGE_KEY, usage);
}

async function getChainsEnvelope(): Promise<ChainsEnvelope> {
  const existing = await getFromLocalStorage<ChainsEnvelope>(CHAINS_KEY);
  if (!existing) {
    const envelope = createEmptyChainsEnvelope();
    await setInLocalStorage(CHAINS_KEY, envelope);
    return envelope;
  }
  return existing;
}

async function saveChainsEnvelope(envelope: ChainsEnvelope): Promise<void> {
  const normalized: ChainsEnvelope = {
    version: CURRENT_CHAINS_SCHEMA_VERSION,
    updatedAt: Date.now(),
    items: envelope.items,
  };
  await setInLocalStorage(CHAINS_KEY, normalized);
}

// ID helpers
function generateId(prefix: string): string {
  const rand = Math.random().toString(36).slice(2);
  return `${prefix}_${Date.now()}_${rand}`;
}

function normalizeTitle(title: string): string {
  return title.trim();
}

function assertUniqueTitle(db: PromptsSchema, title: string, ignoreId?: string): string {
  const normalized = normalizeTitle(title);
  if (!normalized) throw new Error('Title is required.');
  const exists = Object.values(db.promptsById).some((p) => p.title === normalized && p.id !== ignoreId);
  if (exists) throw new Error('A shortcut with that name already exists.');
  return normalized;
}

function collectReferencedAttachmentIds(db: PromptsSchema, chains: PromptChain[]): Set<string> {
  const ids = new Set<string>();
  for (const prompt of Object.values(db.promptsById)) {
    for (const attachment of prompt.attachments) ids.add(attachment.id);
  }
  for (const chain of chains) {
    for (const step of chain.steps) {
      for (const attachment of step.attachments) ids.add(attachment.id);
    }
  }
  return ids;
}

async function cleanupUnusedAttachments(): Promise<void> {
  const [db, chains, metas] = await Promise.all([
    getPrompts(),
    getAllChains(),
    listAttachmentMetas(),
  ]);
  const referenced = collectReferencedAttachmentIds(db, chains);
  await Promise.all(
    metas
      .filter((meta) => !referenced.has(meta.id))
      .map((meta) => deleteAttachment(meta.id))
  );
}

// Prompt operations
export async function savePrompt(prompt: Prompt): Promise<void> {
  const db = await getPrompts();
  const existing = db.promptsById[prompt.id];
  const normalizedTitle = assertUniqueTitle(db, prompt.title, prompt.id);
  const ts = Date.now();
  const normalized: Prompt = {
    ...prompt,
    id: prompt.id || generateId('p'),
    title: normalizedTitle,
    attachments: normalizeAttachmentRefs(prompt.attachments),
    usageCount: prompt.usageCount ?? 0,
    createdAt: existing?.createdAt ?? prompt.createdAt ?? ts,
    updatedAt: ts,
  };
  db.promptsById[normalized.id] = normalized;
  await savePrompts(db);
  await cleanupUnusedAttachments();
}

export async function getPrompt(id: string): Promise<Prompt | null> {
  const db = await getPrompts();
  return db.promptsById[id] ?? null;
}

export async function getAllPrompts(): Promise<Prompt[]> {
  const db = await getPrompts();
  return Object.values(db.promptsById).sort((a, b) => a.title.localeCompare(b.title));
}

export async function deletePrompt(id: string): Promise<void> {
  const db = await getPrompts();
  if (db.promptsById[id]) {
    delete db.promptsById[id];
    await savePrompts(db);
    await cleanupUnusedAttachments();
  }
}

export async function updatePrompt(
  id: string,
  updates: Partial<Prompt>): Promise<void> {
  const db = await getPrompts();
  const existing = db.promptsById[id];
  if (!existing) throw new Error(`Prompt not found: ${id}`);
  const normalizedTitle = assertUniqueTitle(db, updates.title ?? existing.title, id);
  const ts = Date.now();
  db.promptsById[id] = {
    ...existing,
    ...updates,
    id,
    title: normalizedTitle,
    attachments: updates.attachments ? normalizeAttachmentRefs(updates.attachments) : existing.attachments,
    updatedAt: ts,
  };
  await savePrompts(db);
  await cleanupUnusedAttachments();
}

export async function searchPrompts(query: string): Promise<Prompt[]> {
  const q = query.trim().toLowerCase();
  if (!q) return getAllPrompts();
  const db = await getPrompts();

  function scorePrompt(p: Prompt): number {
    let score = 0;
    const title = (p.title || '').toLowerCase();
    const content = (p.content || '').toLowerCase();

    if (title === q) score += 120;
    else if (title.startsWith(q)) score += 100;
    else if (title.includes(q)) score += 80;

    if (content.includes(q)) score += 50;
    if (p.lastUsedAt) score += 5;
    return score;
  }

  const candidates = Object.values(db.promptsById).filter((p) => {
    const hay = [p.title, p.content].join('\n').toLowerCase();
    return hay.includes(q);
  });

  return candidates
    .map((p) => ({ p, s: scorePrompt(p) }))
    .sort((a, b) => b.s - a.s)
    .map(({ p }) => p);
}

export async function logUsage(log: UsageLog): Promise<void> {
  const [db, usage] = await Promise.all([getPrompts(), getUsage()]);

  usage.logs.push({ ...log });
  if (usage.logs.length > 1000) {
    usage.logs = usage.logs.slice(-1000);
  }
  usage.totalUses += 1;

  const prompt = db.promptsById[log.promptId];
  if (prompt) {
    prompt.usageCount = (prompt.usageCount ?? 0) + 1;
    prompt.lastUsedAt = log.timestamp;
    prompt.updatedAt = Date.now();
  }

  await Promise.all([savePrompts(db), saveUsage(usage)]);
}

export async function getUsageStats(): Promise<{ totalPrompts: number; totalUses: number; mostUsedPrompt: Prompt | null }> {
  const [db, usage] = await Promise.all([getPrompts(), getUsage()]);
  const prompts = Object.values(db.promptsById);
  let mostUsedPrompt: Prompt | null = null;
  for (const p of prompts) {
    if (!mostUsedPrompt || (p.usageCount ?? 0) > (mostUsedPrompt.usageCount ?? 0)) {
      mostUsedPrompt = p;
    }
  }
  return { totalPrompts: prompts.length, totalUses: usage.totalUses, mostUsedPrompt };
}

export async function getRecentlyUsedPrompts(limit = 5): Promise<Prompt[]> {
  const db = await getPrompts();
  const prompts = Object.values(db.promptsById);
  return prompts
    .filter((p) => Boolean(p.lastUsedAt))
    .sort((a, b) => {
      const byLast = (b.lastUsedAt ?? 0) - (a.lastUsedAt ?? 0);
      if (byLast !== 0) return byLast;
      const byUpdated = (b.updatedAt ?? 0) - (a.updatedAt ?? 0);
      if (byUpdated !== 0) return byUpdated;
      return (b.createdAt ?? 0) - (a.createdAt ?? 0);
    })
    .slice(0, Math.max(0, limit));
}

// Settings helpers
export async function getSettings(): Promise<AppSettings> {
  return (await getFromLocalStorage<AppSettings>(SETTINGS_KEY)) ?? {};
}

export async function saveSettings(settings: AppSettings): Promise<void> {
  await setInLocalStorage(SETTINGS_KEY, settings);
}

export async function clearAllData(): Promise<void> {
  await setInLocalStorage(PROMPTS_KEY, createEmptyPrompts());
  await setInLocalStorage(CHAINS_KEY, createEmptyChainsEnvelope());
  await setInLocalStorage(USAGE_KEY, createEmptyUsage());
  await removeFromLocalStorage(SETTINGS_KEY);
  const metas = await listAttachmentMetas();
  await Promise.all(metas.map((meta) => deleteAttachment(meta.id)));
}

// Export / Import
export async function exportPrompts(): Promise<PromptExportFile> {
  const db = await getPrompts();
  const prompts = Object.values(db.promptsById);
  return {
    version: 2,
    exportedAt: Date.now(),
    prompts,
  };
}

export async function importPrompts(
  data: unknown,
  options: { mode: ImportMode; duplicateStrategy: DuplicateStrategy }): Promise<{ imported: number; skipped: number; replaced: number; duplicated: number }> {
  if (!data || typeof data !== 'object') throw new Error('Invalid import data');
  const file = data as Partial<PromptExportFile>;
  if (typeof file.version !== 'number' || !Array.isArray(file.prompts)) throw new Error('Invalid prompt export format');

  const db = await getPrompts();
  let imported = 0;
  let skipped = 0;
  let replaced = 0;
  let duplicated = 0;

  if (options.mode === 'replace') {
    db.promptsById = {};
  }

  for (const raw of file.prompts) {
    const p = normalizePrompt(raw);
    if (!p) {
      skipped += 1;
      continue;
    }
    const exists = Boolean(db.promptsById[p.id]);
    if (exists) {
      if (options.duplicateStrategy === 'skip') {
        skipped += 1;
        continue;
      }
      if (options.duplicateStrategy === 'replace') {
        db.promptsById[p.id] = p;
        replaced += 1;
        continue;
      }
      if (options.duplicateStrategy === 'duplicate') {
        const newId = `${p.id}_copy_${Date.now()}`;
        const copy = { ...p, id: newId, createdAt: Date.now(), updatedAt: Date.now() };
        db.promptsById[newId] = copy;
        duplicated += 1;
        continue;
      }
    }
    db.promptsById[p.id] = p;
    imported += 1;
  }

  await savePrompts(db);
  await cleanupUnusedAttachments();
  return { imported, skipped, replaced, duplicated };
}

export async function getAllChains(): Promise<PromptChain[]> {
  const envelope = await getChainsEnvelope();
  return envelope.items;
}

export async function saveChain(chain: PromptChain): Promise<void> {
  const envelope = await getChainsEnvelope();
  const list = envelope.items;
  const idx = list.findIndex((c) => c.id === chain.id);
  const normalized: PromptChain = {
    ...chain,
    id: chain.id || generateId('c'),
    title: chain.title || 'Untitled chain',
    steps: Array.isArray(chain.steps) ? chain.steps.map((s) => normalizeChainStep(s)) : [],
    createdAt: chain.createdAt || Date.now(),
    updatedAt: Date.now(),
  };
  if (idx >= 0) list[idx] = normalized;
  else list.unshift(normalized);
  await saveChainsEnvelope({ ...envelope, items: list });
  await cleanupUnusedAttachments();
}

export async function deleteChain(id: string): Promise<void> {
  const envelope = await getChainsEnvelope();
  const next = envelope.items.filter((c) => c.id !== id);
  await saveChainsEnvelope({ ...envelope, items: next });
  await cleanupUnusedAttachments();
}

export async function searchChains(query: string): Promise<PromptChain[]> {
  const q = query.trim().toLowerCase();
  const chains = await getAllChains();
  if (!q) return chains;

  function scoreChain(chain: PromptChain): number {
    let score = 0;
    const title = (chain.title || '').toLowerCase();
    if (title === q) score += 120;
    else if (title.startsWith(q)) score += 100;
    else if (title.includes(q)) score += 80;

    const stepText = chain.steps.map((s) => s.content || '').join('\n').toLowerCase();
    if (stepText.includes(q)) score += 50;
    return score;
  }

  const candidates = chains.filter((chain) => {
    const hay = [chain.title, ...chain.steps.map((s) => s.content)].join('\n').toLowerCase();
    return hay.includes(q);
  });

  return candidates
    .map((chain) => ({ chain, s: scoreChain(chain) }))
    .sort((a, b) => b.s - a.s)
    .map(({ chain }) => chain);
}

export async function exportChains(): Promise<ChainExportFile> {
  const chains = await getAllChains();
  return {
    version: 2,
    exportedAt: Date.now(),
    chains,
  };
}

export async function importChains(
  data: unknown,
  options: { mode: ImportMode; duplicateStrategy: DuplicateStrategy }): Promise<{ imported: number; skipped: number; replaced: number; duplicated: number }> {
  if (!data || typeof data !== 'object') throw new Error('Invalid import data');
  const file = data as Partial<ChainExportFile>;
  if (typeof file.version !== 'number' || !Array.isArray(file.chains)) throw new Error('Invalid chain export format');

  const envelope = await getChainsEnvelope();
  let list = envelope.items;
  let imported = 0;
  let skipped = 0;
  let replaced = 0;
  let duplicated = 0;

  if (options.mode === 'replace') {
    list = [];
  }

  for (const raw of file.chains) {
    const c = normalizeChain(raw);
    if (!c) {
      skipped += 1;
      continue;
    }

    const idx = list.findIndex((x) => x.id === c.id);
    if (idx >= 0) {
      if (options.duplicateStrategy === 'skip') {
        skipped += 1;
        continue;
      }
      if (options.duplicateStrategy === 'replace') {
        list[idx] = c;
        replaced += 1;
        continue;
      }
      if (options.duplicateStrategy === 'duplicate') {
        const copy = { ...c, id: `${c.id}_copy_${Date.now()}`, createdAt: Date.now(), updatedAt: Date.now() };
        list.unshift(copy);
        duplicated += 1;
        continue;
      }
    } else {
      list.unshift(c);
      imported += 1;
    }
  }

  await saveChainsEnvelope({ ...envelope, items: list });
  await cleanupUnusedAttachments();
  return { imported, skipped, replaced, duplicated };
}

export async function exportLibrary(
  options?: { includeBinaries?: boolean }
): Promise<LibraryExportFile> {
  const [promptFile, chainFile] = await Promise.all([exportPrompts(), exportChains()]);
  const out: LibraryExportFile = {
    version: 3,
    exportedAt: Date.now(),
    prompts: promptFile.prompts,
    chains: chainFile.chains,
  };

  if (options?.includeBinaries) {
    const attachmentIds = new Set<string>();
    for (const prompt of out.prompts) {
      for (const attachment of prompt.attachments) attachmentIds.add(attachment.id);
    }
    for (const chain of out.chains) {
      for (const step of chain.steps) {
        for (const attachment of step.attachments) attachmentIds.add(attachment.id);
      }
    }
    out.attachments = await exportAttachmentRecords(Array.from(attachmentIds));
  }

  return out;
}

type ImportCounts = { imported: number; skipped: number; replaced: number; duplicated: number };

function isLibraryExportFile(input: unknown): input is LibraryExportFile {
  return (
    !!input &&
    typeof input === 'object' &&
    typeof (input as { version?: number }).version === 'number' &&
    Array.isArray((input as { prompts?: unknown[] }).prompts) &&
    Array.isArray((input as { chains?: unknown[] }).chains)
  );
}

function isPromptExportFile(input: unknown): input is PromptExportFile {
  return (
    !!input &&
    typeof input === 'object' &&
    typeof (input as { version?: number }).version === 'number' &&
    Array.isArray((input as { prompts?: unknown[] }).prompts)
  );
}

function isChainExportFile(input: unknown): input is ChainExportFile {
  return (
    !!input &&
    typeof input === 'object' &&
    typeof (input as { version?: number }).version === 'number' &&
    Array.isArray((input as { chains?: unknown[] }).chains)
  );
}

export async function importLibrary(
  data: unknown): Promise<{ prompts?: ImportCounts; chains?: ImportCounts; attachments?: { imported: number } }> {
  const parsed = typeof data === 'string' ? JSON.parse(data) : data;
  const importOptions = { mode: 'merge' as ImportMode, duplicateStrategy: 'replace' as DuplicateStrategy };

  if (isLibraryExportFile(parsed)) {
    const [promptResult, chainResult] = await Promise.all([
      importPrompts(
        { version: parsed.version, exportedAt: parsed.exportedAt, prompts: parsed.prompts },
        importOptions
      ),
      importChains(
        { version: parsed.version, exportedAt: parsed.exportedAt, chains: parsed.chains },
        importOptions
      ),
    ]);

    let attachmentsImported = 0;
    const attachments = Array.isArray(parsed.attachments) ? parsed.attachments as AttachmentExportRecord[] : [];
    if (attachments.length > 0) {
      attachmentsImported = await importAttachmentRecords(attachments);
    }

    await cleanupUnusedAttachments();
    return {
      prompts: promptResult,
      chains: chainResult,
      attachments: { imported: attachmentsImported },
    };
  }

  if (isPromptExportFile(parsed)) {
    const prompts = await importPrompts(parsed, importOptions);
    return { prompts };
  }

  if (isChainExportFile(parsed)) {
    const chains = await importChains(parsed, importOptions);
    return { chains };
  }

  throw new Error('Unrecognized export format. Expected prompts, chains, or combined library export.');
}

