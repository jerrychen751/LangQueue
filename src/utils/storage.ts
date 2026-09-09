import type {
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
  prepareAttachmentImports,
  getAttachmentMeta,
  inferAttachmentKind,
  listAttachmentIds,
  saveAttachmentFile,
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
  const [db, chains, ids] = await Promise.all([
    getPrompts(),
    getAllChainsUnlocked(),
    listAttachmentIds(),
  ]);
  const referenced = collectReferencedAttachmentIds(db, chains);
  const results = await Promise.allSettled(
    ids
      .filter((id) => !referenced.has(id))
      .map((id) => deleteAttachment(id))
  );
  for (const result of results) {
    if (result.status === 'rejected') throw result.reason;
  }
}

async function saveWithAttachments(pendingAttachments: ReadonlyMap<string, File>, save: () => Promise<void>): Promise<void> {
  const written: string[] = [];
  try {
    for (const [id, file] of pendingAttachments) {
      await saveAttachmentFile(file, id);
      written.push(id);
    }
    await save();
  } catch (error) {
    await Promise.allSettled(written.map((id) => deleteAttachment(id)));
    throw error;
  }
}

// Prompt operations
async function savePromptUnlocked(prompt: Prompt, pendingAttachments: ReadonlyMap<string, File> = new Map()): Promise<void> {
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
  await saveWithAttachments(pendingAttachments, () => savePrompts(db));
  await cleanupUnusedAttachments().catch(() => {});
}

async function getPromptUnlocked(id: string): Promise<Prompt | null> {
  const db = await getPrompts();
  return db.promptsById[id] ?? null;
}

async function getAllPromptsUnlocked(): Promise<Prompt[]> {
  const db = await getPrompts();
  return Object.values(db.promptsById).sort((a, b) => a.title.localeCompare(b.title));
}

async function deletePromptUnlocked(id: string): Promise<void> {
  const db = await getPrompts();
  if (db.promptsById[id]) {
    delete db.promptsById[id];
    await savePrompts(db);
    await cleanupUnusedAttachments().catch(() => {});
  }
}

async function updatePromptUnlocked(
  id: string,
  updates: Partial<Prompt>,
  pendingAttachments: ReadonlyMap<string, File> = new Map()): Promise<void> {
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
  await saveWithAttachments(pendingAttachments, () => savePrompts(db));
  await cleanupUnusedAttachments().catch(() => {});
}

async function searchPromptsUnlocked(query: string): Promise<Prompt[]> {
  const q = query.trim().toLowerCase();
  if (!q) return getAllPromptsUnlocked();
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

async function logUsageUnlocked(log: UsageLog): Promise<void> {
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

  db.meta.updatedAt = Date.now();
  await chrome.storage.local.set({ [PROMPTS_KEY]: db, [USAGE_KEY]: usage });
}

async function getUsageStatsUnlocked(): Promise<{ totalPrompts: number; totalUses: number; mostUsedPrompt: Prompt | null }> {
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

async function getRecentlyUsedPromptsUnlocked(limit = 5): Promise<Prompt[]> {
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
async function getSettingsUnlocked(): Promise<AppSettings> {
  return (await getFromLocalStorage<AppSettings>(SETTINGS_KEY)) ?? {};
}

async function saveSettingsUnlocked(settings: AppSettings): Promise<void> {
  await setInLocalStorage(SETTINGS_KEY, settings);
}

async function clearAllDataUnlocked(): Promise<void> {
  await setInLocalStorage(PROMPTS_KEY, createEmptyPrompts());
  await setInLocalStorage(CHAINS_KEY, createEmptyChainsEnvelope());
  await setInLocalStorage(USAGE_KEY, createEmptyUsage());
  await removeFromLocalStorage(SETTINGS_KEY);
  const ids = await listAttachmentIds();
  await Promise.all(ids.map((id) => deleteAttachment(id)));
}

// Export / Import
async function exportPromptsUnlocked(): Promise<PromptExportFile> {
  const db = await getPrompts();
  const prompts = Object.values(db.promptsById);
  return {
    version: 2,
    exportedAt: Date.now(),
    prompts,
  };
}

function mergeImportedPrompts(prompts: Prompt[], options: { mode: ImportMode; duplicateStrategy: DuplicateStrategy }, db: PromptsSchema): ImportCounts {
  db.promptsById = Object.assign(Object.create(null), db.promptsById);
  let imported = 0;
  let skipped = 0;
  let replaced = 0;
  let duplicated = 0;

  if (options.mode === 'replace') {
    db.promptsById = Object.create(null);
  }

  for (const p of prompts) {
    const exists = Object.hasOwn(db.promptsById, p.id);
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
        const newId = generateId(p.id + '_copy');
        const copy = { ...p, id: newId, createdAt: Date.now(), updatedAt: Date.now() };
        db.promptsById[newId] = copy;
        duplicated += 1;
        continue;
      }
    }
    db.promptsById[p.id] = p;
    imported += 1;
  }

  return { imported, skipped, replaced, duplicated };
}

async function getAllChainsUnlocked(): Promise<PromptChain[]> {
  const envelope = await getChainsEnvelope();
  return envelope.items;
}

async function saveChainUnlocked(chain: PromptChain, pendingAttachments: ReadonlyMap<string, File> = new Map()): Promise<void> {
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
  await saveWithAttachments(pendingAttachments, () => saveChainsEnvelope({ ...envelope, items: list }));
  await cleanupUnusedAttachments().catch(() => {});
}

async function deleteChainUnlocked(id: string): Promise<void> {
  const envelope = await getChainsEnvelope();
  const next = envelope.items.filter((c) => c.id !== id);
  await saveChainsEnvelope({ ...envelope, items: next });
  await cleanupUnusedAttachments().catch(() => {});
}

async function searchChainsUnlocked(query: string): Promise<PromptChain[]> {
  const q = query.trim().toLowerCase();
  const chains = await getAllChainsUnlocked();
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

async function exportChainsUnlocked(): Promise<ChainExportFile> {
  const chains = await getAllChainsUnlocked();
  return {
    version: 2,
    exportedAt: Date.now(),
    chains,
  };
}

function mergeImportedChains(chains: PromptChain[], options: { mode: ImportMode; duplicateStrategy: DuplicateStrategy }, envelope: ChainsEnvelope): ImportCounts {
  let list = envelope.items;
  let imported = 0;
  let skipped = 0;
  let replaced = 0;
  let duplicated = 0;

  if (options.mode === 'replace') {
    list = [];
  }

  for (const c of chains) {
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
        const copy = { ...c, id: generateId(c.id + '_copy'), createdAt: Date.now(), updatedAt: Date.now() };
        list.unshift(copy);
        duplicated += 1;
        continue;
      }
    } else {
      list.unshift(c);
      imported += 1;
    }
  }

  envelope.items = list;
  return { imported, skipped, replaced, duplicated };
}

async function exportLibraryUnlocked(
  options?: { includeBinaries?: boolean }
): Promise<LibraryExportFile> {
  const [promptFile, chainFile] = await Promise.all([exportPromptsUnlocked(), exportChainsUnlocked()]);
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

function validateImportedAttachments(raw: unknown): AttachmentRef[] {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) throw new Error('Invalid attachment references in backup.');
  if (raw.some((entry) => entry && typeof entry === 'object' && entry.kind !== undefined && entry.kind !== 'image' && entry.kind !== 'file')) throw new Error('Invalid attachment kind in backup.');
  const refs = normalizeAttachmentRefs(raw);
  if (refs.length !== raw.length || refs.some((ref) => !ref.id || !ref.name || !Number.isSafeInteger(ref.size))) throw new Error('Invalid attachment references in backup.');
  return refs;
}

async function importDataUnlocked(
  data: unknown,
  options: { mode: ImportMode; duplicateStrategy: DuplicateStrategy }
): Promise<{ prompts?: ImportCounts; chains?: ImportCounts; attachments?: { imported: number } }> {
  const parsed = typeof data === 'string' ? JSON.parse(data) : data;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Invalid backup. Expected a JSON object.');
  const file = parsed as Partial<LibraryExportFile>;
  const hasPrompts = Object.hasOwn(file, 'prompts');
  const hasChains = Object.hasOwn(file, 'chains');
  if ((!hasPrompts && !hasChains) || (hasPrompts && !Array.isArray(file.prompts)) || (hasChains && !Array.isArray(file.chains))) throw new Error('Invalid backup. Expected prompts or chains.');
  if (hasPrompts && hasChains ? file.version !== 3 : file.version !== 1 && file.version !== 2) throw new Error('Unsupported backup version. Export a supported backup from LangQueue.');
  const prompts = (file.prompts ?? []).map((raw) => {
    const prompt = normalizePrompt(raw);
    if (!prompt || !prompt.id || !prompt.title.trim()) throw new Error('Invalid prompt in backup.');
    prompt.attachments = validateImportedAttachments(raw.attachments);
    return prompt;
  });
  const chains = (file.chains ?? []).map((raw) => {
    const chain = normalizeChain(raw);
    if (!chain || !chain.id || !chain.title.trim() || !Array.isArray(raw.steps)) throw new Error('Invalid chain in backup.');
    chain.steps = raw.steps.map((step) => {
      if (typeof step === 'string') return normalizeChainStep(step);
      if (!step || typeof step !== 'object' || typeof step.content !== 'string') throw new Error('Invalid chain step in backup.');
      return { content: step.content, attachments: validateImportedAttachments(step.attachments) };
    });
    return chain;
  });
  const binaries = prepareAttachmentImports(Object.hasOwn(file, 'attachments') ? file.attachments : []);
  const storedPrompts = await getFromLocalStorage<unknown>(PROMPTS_KEY);
  let db: PromptsSchema;
  if (storedPrompts === undefined) {
    db = createEmptyPrompts();
  } else {
    if (!storedPrompts || typeof storedPrompts !== 'object') throw new Error('Stored prompt library is invalid. Export your existing data before importing.');
    const current = storedPrompts as { meta?: Partial<PromptsSchema['meta']>; prompts?: unknown; promptsById?: unknown };
    const version = current.meta?.schemaVersion;
    if (version !== undefined && (typeof version !== 'number' || !Number.isInteger(version) || version < 1 || version > CURRENT_SCHEMA_VERSION)) throw new Error('Unsupported stored prompt schema.');
    const records = Array.isArray(storedPrompts) ? storedPrompts : Array.isArray(current.prompts) ? current.prompts : current.promptsById && typeof current.promptsById === 'object' && !Array.isArray(current.promptsById) ? Object.values(current.promptsById) : null;
    if (!records) throw new Error('Stored prompt library is invalid.');
    const promptsById: Record<string, Prompt> = Object.create(null);
    for (const raw of records) {
      const prompt = normalizePrompt(raw);
      if (!prompt || Object.hasOwn(promptsById, prompt.id)) throw new Error('Stored prompt library contains invalid or duplicate records.');
      prompt.attachments = validateImportedAttachments((raw as Partial<Prompt>).attachments);
      promptsById[prompt.id] = prompt;
    }
    db = { meta: { schemaVersion: CURRENT_SCHEMA_VERSION, createdAt: safeNumber(current.meta?.createdAt, Date.now()), updatedAt: safeNumber(current.meta?.updatedAt, Date.now()) }, promptsById };
  }
  const storedChains = await getFromLocalStorage<unknown>(CHAINS_KEY);
  let envelope: ChainsEnvelope;
  if (storedChains === undefined) {
    envelope = createEmptyChainsEnvelope();
  } else {
    if (!storedChains || typeof storedChains !== 'object') throw new Error('Stored chain library is invalid.');
    const current = storedChains as { version?: unknown; updatedAt?: unknown; items?: unknown };
    if (current.version !== undefined && (typeof current.version !== 'number' || !Number.isInteger(current.version) || current.version < 1 || current.version > CURRENT_CHAINS_SCHEMA_VERSION)) throw new Error('Unsupported stored chain schema.');
    const records = Array.isArray(storedChains) ? storedChains : Array.isArray(current.items) ? current.items : null;
    if (!records) throw new Error('Stored chain library is invalid.');
    const items = records.map((raw) => {
      const chain = normalizeChain(raw);
      if (!chain || !Array.isArray(raw.steps)) throw new Error('Stored chain library contains invalid records.');
      chain.steps = raw.steps.map((step: unknown) => {
        if (typeof step === 'string') return normalizeChainStep(step);
        if (!step || typeof step !== 'object' || typeof (step as Partial<PromptStep>).content !== 'string') throw new Error('Stored chain contains an invalid step.');
        const candidate = step as PromptStep;
        return { content: candidate.content, attachments: validateImportedAttachments(candidate.attachments) };
      });
      return chain;
    });
    envelope = { version: CURRENT_CHAINS_SCHEMA_VERSION, updatedAt: safeNumber(current.updatedAt, Date.now()), items };
  }
  const result: { prompts?: ImportCounts; chains?: ImportCounts; attachments?: { imported: number } } = {};
  if (hasPrompts) {
    result.prompts = mergeImportedPrompts(prompts, options, db);
    db.meta.updatedAt = Date.now();
  }
  if (hasChains) {
    result.chains = mergeImportedChains(chains, options, envelope);
    envelope.updatedAt = Date.now();
  }
  const selectedRefs = new Set([...Object.values(db.promptsById).map((prompt) => prompt.attachments), ...envelope.items.flatMap((chain) => chain.steps.map((step) => step.attachments))]);
  const binaryById = new Map(binaries.map((binary) => [binary.ref.id, binary]));
  const existingById = new Map<string, AttachmentRef>();
  const remappedById = new Map<string, AttachmentRef>();
  const pendingAttachments = new Map<string, File>();
  for (const refs of [...prompts.map((prompt) => prompt.attachments), ...chains.flatMap((chain) => chain.steps.map((step) => step.attachments))]) {
    if (!selectedRefs.has(refs)) continue;
    for (let index = 0; index < refs.length; index++) {
      const ref = refs[index];
      const binary = binaryById.get(ref.id);
      let stored = binary?.ref ?? existingById.get(ref.id);
      if (!stored) {
        stored = (await getAttachmentMeta(ref.id)) ?? undefined;
        if (stored) existingById.set(ref.id, stored);
      }
      if (!stored) throw new Error('Missing attachment "' + ref.name + '". Export again with attachment files included, then import that backup.');
      if (stored.size !== ref.size || stored.mimeType !== ref.mimeType || stored.name !== ref.name || stored.kind !== ref.kind) throw new Error('Attachment metadata does not match its file: ' + ref.name);
      if (binary) {
        let remapped = remappedById.get(ref.id);
        if (!remapped) {
          remapped = { ...stored, id: 'a_' + crypto.randomUUID() };
          remappedById.set(ref.id, remapped);
          pendingAttachments.set(remapped.id, binary.file);
        }
        refs[index] = { ...remapped };
      }
    }
  }
  const updates = { [PROMPTS_KEY]: db, [CHAINS_KEY]: envelope };
  const referenced = collectReferencedAttachmentIds(db, envelope.items);
  for (const id of pendingAttachments.keys()) {
    if (!referenced.has(id)) pendingAttachments.delete(id);
  }
  await saveWithAttachments(pendingAttachments, () => chrome.storage.local.set(updates));
  await cleanupUnusedAttachments().catch(() => {});
  if (hasPrompts && hasChains) result.attachments = { imported: pendingAttachments.size };
  return result;
}

async function importPromptsUnlocked(data: unknown, options: { mode: ImportMode; duplicateStrategy: DuplicateStrategy }): Promise<ImportCounts> {
  if (!data || typeof data !== 'object' || !Object.hasOwn(data, 'prompts') || Object.hasOwn(data, 'chains')) throw new Error('Invalid prompt export format');
  return (await importDataUnlocked(data, options)).prompts!;
}

async function importChainsUnlocked(data: unknown, options: { mode: ImportMode; duplicateStrategy: DuplicateStrategy }): Promise<ImportCounts> {
  if (!data || typeof data !== 'object' || !Object.hasOwn(data, 'chains') || Object.hasOwn(data, 'prompts')) throw new Error('Invalid chain export format');
  return (await importDataUnlocked(data, options)).chains!;
}

async function importLibraryUnlocked(data: unknown) {
  return importDataUnlocked(data, { mode: 'merge', duplicateStrategy: 'replace' });
}

function serializeStorageOperation<Args extends unknown[], Result>(
  operation: (...args: Args) => Promise<Result>
): (...args: Args) => Promise<Result> {
  return async (...args) => await navigator.locks.request('langqueue-storage', () => operation(...args));
}

export const savePrompt = serializeStorageOperation(savePromptUnlocked);
export const getPrompt = serializeStorageOperation(getPromptUnlocked);
export const getAllPrompts = serializeStorageOperation(getAllPromptsUnlocked);
export const deletePrompt = serializeStorageOperation(deletePromptUnlocked);
export const updatePrompt = serializeStorageOperation(updatePromptUnlocked);
export const searchPrompts = serializeStorageOperation(searchPromptsUnlocked);
export const logUsage = serializeStorageOperation(logUsageUnlocked);
export const getUsageStats = serializeStorageOperation(getUsageStatsUnlocked);
export const getRecentlyUsedPrompts = serializeStorageOperation(getRecentlyUsedPromptsUnlocked);
export const getSettings = serializeStorageOperation(getSettingsUnlocked);
export const saveSettings = serializeStorageOperation(saveSettingsUnlocked);
export const clearAllData = serializeStorageOperation(clearAllDataUnlocked);
export const exportPrompts = serializeStorageOperation(exportPromptsUnlocked);
export const importPrompts = serializeStorageOperation(importPromptsUnlocked);
export const getAllChains = serializeStorageOperation(getAllChainsUnlocked);
export const saveChain = serializeStorageOperation(saveChainUnlocked);
export const deleteChain = serializeStorageOperation(deleteChainUnlocked);
export const searchChains = serializeStorageOperation(searchChainsUnlocked);
export const exportChains = serializeStorageOperation(exportChainsUnlocked);
export const importChains = serializeStorageOperation(importChainsUnlocked);
export const exportLibrary = serializeStorageOperation(exportLibraryUnlocked);
export const importLibrary = serializeStorageOperation(importLibraryUnlocked);
