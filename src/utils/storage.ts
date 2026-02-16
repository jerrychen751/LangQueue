import type {
  AttachmentExportRecord,
  AttachmentRef,
  AppSettings,
  ChainExportFile,
  ChainsEnvelope,
  DBSchema,
  DuplicateStrategy,
  ImportMode,
  LibraryExportFile,
  MigrationStatus,
  Prompt,
  PromptExportFile,
  SavedChain,
  SavedChainStep,
  UsageLog,
} from '../types'
import { CURRENT_CHAINS_SCHEMA_VERSION, CURRENT_SCHEMA_VERSION } from '../types'
import {
  deleteAttachment,
  exportAttachmentRecords,
  importAttachmentRecords,
  inferAttachmentKind,
  listAttachmentMetas,
} from './attachments'

export type StorageArea = 'local' | 'sync'

const DB_KEY = 'langqueue_db'
const CHAINS_KEY = 'langqueue_chains'
const SETTINGS_KEY = 'langqueue_settings'
const TOTAL_USES_KEY = 'langqueue_total_uses'
const MIGRATION_STATUS_KEY = 'langqueue_migration_status'

const DB_BACKUP_PREFIX = 'langqueue_db_backup_'
const CHAINS_BACKUP_PREFIX = 'langqueue_chains_backup_'

function now(): number {
  return Date.now()
}

async function getFromStorage<T>(key: string, area: StorageArea = 'local'): Promise<T | undefined> {
  return new Promise((resolve, reject) => {
    try {
      chrome.storage[area].get([key], (result) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message))
          return
        }
        resolve(result[key] as T | undefined)
      })
    } catch (err) {
      reject(err)
    }
  })
}

async function setInStorage<T>(key: string, value: T, area: StorageArea = 'local'): Promise<void> {
  return new Promise((resolve, reject) => {
    try {
      chrome.storage[area].set({ [key]: value }, () => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message))
          return
        }
        resolve()
      })
    } catch (err) {
      reject(err)
    }
  })
}

async function removeFromStorage(key: string, area: StorageArea = 'local'): Promise<void> {
  return new Promise((resolve, reject) => {
    try {
      chrome.storage[area].remove([key], () => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message))
          return
        }
        resolve()
      })
    } catch (err) {
      reject(err)
    }
  })
}

async function writeMigrationStatus(
  status: Omit<MigrationStatus, 'toVersion'> & { toVersion?: number },
  area: StorageArea = 'local'
): Promise<void> {
  const payload: MigrationStatus = {
    ...status,
    toVersion: typeof status.toVersion === 'number' ? status.toVersion : CURRENT_SCHEMA_VERSION,
  }
  await setInStorage(MIGRATION_STATUS_KEY, payload, area)
}

async function backupPayload(prefix: string, payload: unknown, area: StorageArea): Promise<string | undefined> {
  try {
    const key = `${prefix}${Date.now()}`
    await setInStorage(key, payload, area)
    return key
  } catch {
    return undefined
  }
}

function safeNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function normalizeAttachmentRefs(raw: unknown): AttachmentRef[] {
  if (!Array.isArray(raw)) return []
  const out: AttachmentRef[] = []
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue
    const candidate = entry as Partial<AttachmentRef>
    if (typeof candidate.id !== 'string' || typeof candidate.name !== 'string' || typeof candidate.mimeType !== 'string') continue
    const size = safeNumber(candidate.size, 0)
    if (size <= 0) continue
    const kind = candidate.kind === 'image' || candidate.kind === 'file'
      ? candidate.kind
      : inferAttachmentKind(candidate.mimeType)
    out.push({
      id: candidate.id,
      name: candidate.name,
      mimeType: candidate.mimeType,
      size,
      kind,
      createdAt: safeNumber(candidate.createdAt, now()),
    })
  }
  return out
}

function normalizePrompt(raw: unknown): Prompt | null {
  if (!raw || typeof raw !== 'object') return null
  const candidate = raw as Partial<Prompt>
  if (typeof candidate.id !== 'string') return null
  if (typeof candidate.title !== 'string') return null
  if (typeof candidate.content !== 'string') return null
  const ts = now()
  return {
    id: candidate.id,
    title: candidate.title,
    content: candidate.content,
    attachments: normalizeAttachmentRefs(candidate.attachments),
    usageCount: safeNumber(candidate.usageCount, 0),
    createdAt: safeNumber(candidate.createdAt, ts),
    updatedAt: safeNumber(candidate.updatedAt, ts),
    lastUsedAt: typeof candidate.lastUsedAt === 'number' ? candidate.lastUsedAt : undefined,
  }
}

function normalizeUsageLog(raw: unknown): UsageLog | null {
  if (!raw || typeof raw !== 'object') return null
  const candidate = raw as Partial<UsageLog>
  if (typeof candidate.promptId !== 'string') return null
  if (typeof candidate.platform !== 'string') return null
  const timestamp = safeNumber(candidate.timestamp, now())
  return {
    promptId: candidate.promptId,
    platform: candidate.platform,
    timestamp,
  }
}

function normalizeDBCandidate(raw: unknown, schemaVersion: number): DBSchema {
  const ts = now()
  const source = (raw && typeof raw === 'object') ? (raw as Record<string, unknown>) : {}
  const metaRaw = (source.meta && typeof source.meta === 'object') ? (source.meta as Record<string, unknown>) : {}

  const promptsByIdRaw = (source.promptsById && typeof source.promptsById === 'object')
    ? (source.promptsById as Record<string, unknown>)
    : {}
  const promptOrderRaw = Array.isArray(source.promptOrder) ? source.promptOrder : []

  const promptsById: Record<string, Prompt> = {}
  for (const [id, value] of Object.entries(promptsByIdRaw)) {
    const normalized = normalizePrompt(value)
    if (!normalized) continue
    promptsById[id] = { ...normalized, id }
  }

  const promptOrder = promptOrderRaw
    .filter((id): id is string => typeof id === 'string' && Boolean(promptsById[id]))
  for (const id of Object.keys(promptsById)) {
    if (!promptOrder.includes(id)) promptOrder.push(id)
  }

  const usageLogsRaw = Array.isArray(source.usageLogs) ? source.usageLogs : []
  const usageLogs = usageLogsRaw
    .map((entry) => normalizeUsageLog(entry))
    .filter((entry): entry is UsageLog => Boolean(entry))

  return {
    meta: {
      schemaVersion,
      createdAt: safeNumber(metaRaw.createdAt, ts),
      updatedAt: safeNumber(metaRaw.updatedAt, ts),
    },
    promptsById,
    promptOrder,
    usageLogs,
  }
}

function migrateV1ToV2(raw: unknown): DBSchema {
  return normalizeDBCandidate(raw, 2)
}

function migrateV2ToV3(raw: unknown): DBSchema {
  return normalizeDBCandidate(raw, 3)
}

function getRawSchemaVersion(raw: unknown): number | null {
  if (!raw || typeof raw !== 'object') return null
  const source = raw as Record<string, unknown>
  const meta = source.meta
  if (meta && typeof meta === 'object') {
    const schemaVersion = (meta as { schemaVersion?: unknown }).schemaVersion
    if (typeof schemaVersion === 'number' && Number.isFinite(schemaVersion)) return schemaVersion
  }
  if (source.promptsById && typeof source.promptsById === 'object' && Array.isArray(source.promptOrder)) {
    return 1
  }
  return null
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
  ]
  return templates.map((item, index) => ({
    id: generateId('p'),
    title: item.title,
    content: item.content,
    attachments: [],
    usageCount: 0,
    createdAt: timestamp - index,
    updatedAt: timestamp - index,
  }))
}

function createEmptyDB(): DBSchema {
  const ts = now()
  const defaults = getDefaultPrompts(ts)
  const promptsById = Object.fromEntries(defaults.map((prompt) => [prompt.id, prompt]))
  const promptOrder = defaults.map((prompt) => prompt.id)
  return {
    meta: { schemaVersion: CURRENT_SCHEMA_VERSION, createdAt: ts, updatedAt: ts },
    promptsById,
    promptOrder,
    usageLogs: [],
  }
}

function createEmptyChainsEnvelope(): ChainsEnvelope {
  return {
    version: CURRENT_CHAINS_SCHEMA_VERSION,
    updatedAt: now(),
    items: [],
  }
}

function normalizeChainStep(raw: unknown): SavedChainStep {
  if (typeof raw === 'string') {
    return { content: raw, attachments: [] }
  }
  if (!raw || typeof raw !== 'object') {
    return { content: '', attachments: [] }
  }
  const candidate = raw as Partial<SavedChainStep>
  return {
    content: typeof candidate.content === 'string' ? candidate.content : '',
    attachments: normalizeAttachmentRefs(candidate.attachments),
    autoSend: typeof candidate.autoSend === 'boolean' ? candidate.autoSend : undefined,
    awaitResponse: typeof candidate.awaitResponse === 'boolean' ? candidate.awaitResponse : undefined,
    delayMs: typeof candidate.delayMs === 'number' ? candidate.delayMs : undefined,
  }
}

function normalizeChain(raw: unknown): SavedChain | null {
  if (!raw || typeof raw !== 'object') return null
  const candidate = raw as Partial<SavedChain>
  if (typeof candidate.id !== 'string') return null
  if (typeof candidate.title !== 'string') return null
  const ts = now()
  const stepsRaw = Array.isArray(candidate.steps) ? candidate.steps : []
  return {
    id: candidate.id,
    title: candidate.title,
    description: typeof candidate.description === 'string' ? candidate.description : undefined,
    steps: stepsRaw.map((step) => normalizeChainStep(step)),
    createdAt: safeNumber(candidate.createdAt, ts),
    updatedAt: safeNumber(candidate.updatedAt, ts),
  }
}

async function migrateChainsEnvelope(raw: unknown, area: StorageArea = 'local'): Promise<ChainsEnvelope> {
  if (raw === undefined || raw === null) {
    return createEmptyChainsEnvelope()
  }

  if (Array.isArray(raw)) {
    const items = raw
      .map((entry) => normalizeChain(entry))
      .filter((entry): entry is SavedChain => Boolean(entry))
    return {
      version: CURRENT_CHAINS_SCHEMA_VERSION,
      updatedAt: now(),
      items,
    }
  }

  if (raw && typeof raw === 'object') {
    const source = raw as Record<string, unknown>
    const version = typeof source.version === 'number' ? source.version : null

    if (version === 1 && Array.isArray(source.chains)) {
      const items = source.chains
        .map((entry) => normalizeChain(entry))
        .filter((entry): entry is SavedChain => Boolean(entry))
      return {
        version: CURRENT_CHAINS_SCHEMA_VERSION,
        updatedAt: now(),
        items,
      }
    }

    if (version === 2 && Array.isArray(source.items)) {
      const items = source.items
        .map((entry) => normalizeChain(entry))
        .filter((entry): entry is SavedChain => Boolean(entry))
      return {
        version: CURRENT_CHAINS_SCHEMA_VERSION,
        updatedAt: safeNumber(source.updatedAt, now()),
        items,
      }
    }

    const backupKey = await backupPayload(CHAINS_BACKUP_PREFIX, raw, area)
    await writeMigrationStatus({
      lastMigrationAt: now(),
      fromVersion: version,
      toVersion: CURRENT_SCHEMA_VERSION,
      result: 'recovered_empty',
      reason: 'INVALID_CHAINS_PAYLOAD',
      backupKey,
    }, area)
    return createEmptyChainsEnvelope()
  }

  const backupKey = await backupPayload(CHAINS_BACKUP_PREFIX, raw, area)
  await writeMigrationStatus({
    lastMigrationAt: now(),
    fromVersion: null,
    toVersion: CURRENT_SCHEMA_VERSION,
    result: 'recovered_empty',
    reason: 'UNREADABLE_CHAINS_PAYLOAD',
    backupKey,
  }, area)
  return createEmptyChainsEnvelope()
}

// Migrations
export async function migrateDB(db: unknown, area: StorageArea = 'local'): Promise<DBSchema> {
  const sourceVersion = getRawSchemaVersion(db)

  if (sourceVersion === null) {
    const backupKey = await backupPayload(DB_BACKUP_PREFIX, db, area)
    await writeMigrationStatus({
      lastMigrationAt: now(),
      fromVersion: null,
      toVersion: CURRENT_SCHEMA_VERSION,
      result: 'recovered_empty',
      reason: 'INVALID_DB_SHAPE',
      backupKey,
    }, area)
    return createEmptyDB()
  }

  if (sourceVersion > CURRENT_SCHEMA_VERSION) {
    const backupKey = await backupPayload(DB_BACKUP_PREFIX, db, area)
    await writeMigrationStatus({
      lastMigrationAt: now(),
      fromVersion: sourceVersion,
      toVersion: CURRENT_SCHEMA_VERSION,
      result: 'recovered_empty',
      reason: 'UNKNOWN_FUTURE_SCHEMA',
      backupKey,
    }, area)
    return createEmptyDB()
  }

  let working: unknown = db
  let workingVersion = sourceVersion

  if (workingVersion === 1) {
    working = migrateV1ToV2(working)
    workingVersion = 2
  }
  if (workingVersion === 2) {
    working = migrateV2ToV3(working)
    workingVersion = 3
  }

  if (workingVersion !== CURRENT_SCHEMA_VERSION) {
    const backupKey = await backupPayload(DB_BACKUP_PREFIX, db, area)
    await writeMigrationStatus({
      lastMigrationAt: now(),
      fromVersion: sourceVersion,
      toVersion: CURRENT_SCHEMA_VERSION,
      result: 'recovered_empty',
      reason: 'UNSUPPORTED_SCHEMA_PATH',
      backupKey,
    }, area)
    return createEmptyDB()
  }

  const migrated = normalizeDBCandidate(working, CURRENT_SCHEMA_VERSION)
  await writeMigrationStatus({
    lastMigrationAt: now(),
    fromVersion: sourceVersion,
    toVersion: CURRENT_SCHEMA_VERSION,
    result: 'ok',
  }, area)
  return migrated
}

async function getDB(area: StorageArea = 'local'): Promise<DBSchema> {
  const existing = await getFromStorage<unknown>(DB_KEY, area)
  if (!existing) {
    const db = createEmptyDB()
    await setInStorage(DB_KEY, db, area)
    return db
  }
  const migrated = await migrateDB(existing, area)
  await setInStorage(DB_KEY, migrated, area)
  return migrated
}

async function saveDB(db: DBSchema, area: StorageArea = 'local'): Promise<void> {
  db.meta.updatedAt = now()
  await setInStorage(DB_KEY, db, area)
}

async function getChainsEnvelope(area: StorageArea = 'local'): Promise<ChainsEnvelope> {
  const raw = await getFromStorage<unknown>(CHAINS_KEY, area)
  const migrated = await migrateChainsEnvelope(raw, area)
  await setInStorage(CHAINS_KEY, migrated, area)
  return migrated
}

async function saveChainsEnvelope(envelope: ChainsEnvelope, area: StorageArea = 'local'): Promise<void> {
  const normalized: ChainsEnvelope = {
    version: CURRENT_CHAINS_SCHEMA_VERSION,
    updatedAt: now(),
    items: envelope.items,
  }
  await setInStorage(CHAINS_KEY, normalized, area)
}

// ID helpers
function generateId(prefix: string): string {
  const rand = Math.random().toString(36).slice(2)
  return `${prefix}_${Date.now()}_${rand}`
}

function normalizeTitle(title: string): string {
  return title.trim()
}

function assertUniqueTitle(db: DBSchema, title: string, ignoreId?: string): string {
  const normalized = normalizeTitle(title)
  if (!normalized) throw new Error('Title is required.')
  const exists = Object.values(db.promptsById).some((p) => p.title === normalized && p.id !== ignoreId)
  if (exists) throw new Error('A shortcut with that name already exists.')
  return normalized
}

function collectReferencedAttachmentIds(db: DBSchema, chains: SavedChain[]): Set<string> {
  const ids = new Set<string>()
  for (const prompt of Object.values(db.promptsById)) {
    for (const attachment of prompt.attachments) ids.add(attachment.id)
  }
  for (const chain of chains) {
    for (const step of chain.steps) {
      for (const attachment of step.attachments) ids.add(attachment.id)
    }
  }
  return ids
}

async function cleanupUnusedAttachments(area: StorageArea = 'local'): Promise<void> {
  if (area !== 'local') return
  const [db, chains, metas] = await Promise.all([
    getDB(area),
    getAllChains(area),
    listAttachmentMetas(),
  ])
  const referenced = collectReferencedAttachmentIds(db, chains)
  await Promise.all(
    metas
      .filter((meta) => !referenced.has(meta.id))
      .map((meta) => deleteAttachment(meta.id))
  )
}

// Prompt operations
export async function savePrompt(prompt: Prompt, area: StorageArea = 'local'): Promise<void> {
  const db = await getDB(area)
  const existing = db.promptsById[prompt.id]
  const normalizedTitle = assertUniqueTitle(db, prompt.title, prompt.id)
  const ts = now()
  const normalized: Prompt = {
    ...prompt,
    id: prompt.id || generateId('p'),
    title: normalizedTitle,
    attachments: normalizeAttachmentRefs(prompt.attachments),
    usageCount: prompt.usageCount ?? 0,
    createdAt: existing?.createdAt ?? prompt.createdAt ?? ts,
    updatedAt: ts,
  }
  db.promptsById[normalized.id] = normalized
  if (!db.promptOrder.includes(normalized.id)) db.promptOrder.unshift(normalized.id)
  await saveDB(db, area)
  await cleanupUnusedAttachments(area)
}

export async function getPrompt(id: string, area: StorageArea = 'local'): Promise<Prompt | null> {
  const db = await getDB(area)
  return db.promptsById[id] ?? null
}

export async function getAllPrompts(area: StorageArea = 'local'): Promise<Prompt[]> {
  const db = await getDB(area)
  return db.promptOrder.map((pid) => db.promptsById[pid]).filter(Boolean)
}

export async function deletePrompt(id: string, area: StorageArea = 'local'): Promise<void> {
  const db = await getDB(area)
  if (db.promptsById[id]) {
    delete db.promptsById[id]
    db.promptOrder = db.promptOrder.filter((pid) => pid !== id)
    await saveDB(db, area)
    await cleanupUnusedAttachments(area)
  }
}

export async function updatePrompt(
  id: string,
  updates: Partial<Prompt>,
  area: StorageArea = 'local'
): Promise<void> {
  const db = await getDB(area)
  const existing = db.promptsById[id]
  if (!existing) throw new Error(`Prompt not found: ${id}`)
  const normalizedTitle = assertUniqueTitle(db, updates.title ?? existing.title, id)
  const ts = now()
  db.promptsById[id] = {
    ...existing,
    ...updates,
    id,
    title: normalizedTitle,
    attachments: updates.attachments ? normalizeAttachmentRefs(updates.attachments) : existing.attachments,
    updatedAt: ts,
  }
  await saveDB(db, area)
  await cleanupUnusedAttachments(area)
}

export async function searchPrompts(query: string, area: StorageArea = 'local'): Promise<Prompt[]> {
  const q = query.trim().toLowerCase()
  if (!q) return getAllPrompts(area)
  const db = await getDB(area)

  function scorePrompt(p: Prompt): number {
    let score = 0
    const title = (p.title || '').toLowerCase()
    const content = (p.content || '').toLowerCase()

    if (title === q) score += 120
    else if (title.startsWith(q)) score += 100
    else if (title.includes(q)) score += 80

    if (content.includes(q)) score += 50
    if (p.lastUsedAt) score += 5
    return score
  }

  const candidates = Object.values(db.promptsById).filter((p) => {
    const hay = [p.title, p.content].join('\n').toLowerCase()
    return hay.includes(q)
  })

  return candidates
    .map((p) => ({ p, s: scorePrompt(p) }))
    .sort((a, b) => b.s - a.s)
    .map(({ p }) => p)
}

export async function logUsage(log: UsageLog, area: StorageArea = 'local'): Promise<void> {
  const db = await getDB(area)
  db.usageLogs.push({ ...log })
  if (db.usageLogs.length > 1000) {
    db.usageLogs = db.usageLogs.slice(-1000)
  }
  const prompt = db.promptsById[log.promptId]
  if (prompt) {
    prompt.usageCount = (prompt.usageCount ?? 0) + 1
    prompt.lastUsedAt = log.timestamp
    prompt.updatedAt = now()
  }
  await saveDB(db, area)
  try {
    const current = (await getFromStorage<number>(TOTAL_USES_KEY, area)) ?? 0
    await setInStorage(TOTAL_USES_KEY, current + 1, area)
  } catch {
    // swallow
  }
}

export async function getUsageStats(
  area: StorageArea = 'local'
): Promise<{ totalPrompts: number; totalUses: number; mostUsedPrompt: Prompt | null }> {
  const db = await getDB(area)
  const prompts = Object.values(db.promptsById)
  const totalPrompts = prompts.length
  let totalUses = 0
  let mostUsedPrompt: Prompt | null = null
  for (const p of prompts) {
    const uses = p.usageCount ?? 0
    totalUses += uses
    if (!mostUsedPrompt || uses > (mostUsedPrompt.usageCount ?? 0)) {
      mostUsedPrompt = p
    }
  }
  try {
    const stored = await getFromStorage<number>(TOTAL_USES_KEY, area)
    if (typeof stored === 'number') {
      return { totalPrompts, totalUses: stored, mostUsedPrompt }
    }
    await setInStorage(TOTAL_USES_KEY, totalUses, area)
  } catch {
    // swallow
  }
  return { totalPrompts, totalUses, mostUsedPrompt }
}

export async function getRecentlyUsedPrompts(limit = 5, area: StorageArea = 'local'): Promise<Prompt[]> {
  const db = await getDB(area)
  const prompts = Object.values(db.promptsById)
  return prompts
    .filter((p) => Boolean(p.lastUsedAt))
    .sort((a, b) => {
      const byLast = (b.lastUsedAt ?? 0) - (a.lastUsedAt ?? 0)
      if (byLast !== 0) return byLast
      const byUpdated = (b.updatedAt ?? 0) - (a.updatedAt ?? 0)
      if (byUpdated !== 0) return byUpdated
      return (b.createdAt ?? 0) - (a.createdAt ?? 0)
    })
    .slice(0, Math.max(0, limit))
}

// Settings helpers
export async function getSettings(area: StorageArea = 'local'): Promise<AppSettings> {
  return (await getFromStorage<AppSettings>(SETTINGS_KEY, area)) ?? {}
}

export async function saveSettings(settings: AppSettings, area: StorageArea = 'local'): Promise<void> {
  await setInStorage(SETTINGS_KEY, settings, area)
}

export async function clearAllData(area: StorageArea = 'local'): Promise<void> {
  const empty = createEmptyDB()
  await setInStorage(DB_KEY, empty, area)
  await setInStorage(CHAINS_KEY, createEmptyChainsEnvelope(), area)
  await removeFromStorage(SETTINGS_KEY, area)
  await removeFromStorage(TOTAL_USES_KEY, area)
  await removeFromStorage(MIGRATION_STATUS_KEY, area)
  if (area === 'local') {
    const metas = await listAttachmentMetas()
    await Promise.all(metas.map((meta) => deleteAttachment(meta.id)))
  }
}

// Export / Import
export async function exportPrompts(area: StorageArea = 'local'): Promise<PromptExportFile> {
  const db = await getDB(area)
  const prompts = Object.values(db.promptsById)
  return {
    version: 2,
    exportedAt: Date.now(),
    prompts,
  }
}

export async function importPrompts(
  data: unknown,
  options: { mode: ImportMode; duplicateStrategy: DuplicateStrategy },
  area: StorageArea = 'local'
): Promise<{ imported: number; skipped: number; replaced: number; duplicated: number }> {
  if (!data || typeof data !== 'object') throw new Error('Invalid import data')
  const file = data as Partial<PromptExportFile>
  if (typeof file.version !== 'number' || !Array.isArray(file.prompts)) throw new Error('Invalid prompt export format')

  const db = await getDB(area)
  let imported = 0
  let skipped = 0
  let replaced = 0
  let duplicated = 0

  if (options.mode === 'replace') {
    db.promptsById = {}
    db.promptOrder = []
  }

  for (const raw of file.prompts) {
    const p = normalizePrompt(raw)
    if (!p) {
      skipped += 1
      continue
    }
    const exists = Boolean(db.promptsById[p.id])
    if (exists) {
      if (options.duplicateStrategy === 'skip') {
        skipped += 1
        continue
      }
      if (options.duplicateStrategy === 'replace') {
        db.promptsById[p.id] = p
        if (!db.promptOrder.includes(p.id)) db.promptOrder.unshift(p.id)
        replaced += 1
        continue
      }
      if (options.duplicateStrategy === 'duplicate') {
        const newId = `${p.id}_copy_${Date.now()}`
        const copy = { ...p, id: newId, createdAt: Date.now(), updatedAt: Date.now() }
        db.promptsById[newId] = copy
        db.promptOrder.unshift(newId)
        duplicated += 1
        continue
      }
    }
    db.promptsById[p.id] = p
    db.promptOrder.unshift(p.id)
    imported += 1
  }

  await saveDB(db, area)
  await cleanupUnusedAttachments(area)
  return { imported, skipped, replaced, duplicated }
}

export async function getAllChains(area: StorageArea = 'local'): Promise<SavedChain[]> {
  const envelope = await getChainsEnvelope(area)
  return envelope.items
}

export async function saveChain(chain: SavedChain, area: StorageArea = 'local'): Promise<void> {
  const envelope = await getChainsEnvelope(area)
  const list = envelope.items
  const idx = list.findIndex((c) => c.id === chain.id)
  const normalized: SavedChain = {
    ...chain,
    id: chain.id || generateId('c'),
    title: chain.title || 'Untitled chain',
    steps: Array.isArray(chain.steps) ? chain.steps.map((s) => normalizeChainStep(s)) : [],
    createdAt: chain.createdAt || now(),
    updatedAt: now(),
  }
  if (idx >= 0) list[idx] = normalized
  else list.unshift(normalized)
  await saveChainsEnvelope({ ...envelope, items: list }, area)
  await cleanupUnusedAttachments(area)
}

export async function deleteChain(id: string, area: StorageArea = 'local'): Promise<void> {
  const envelope = await getChainsEnvelope(area)
  const next = envelope.items.filter((c) => c.id !== id)
  await saveChainsEnvelope({ ...envelope, items: next }, area)
  await cleanupUnusedAttachments(area)
}

export async function searchChains(query: string, area: StorageArea = 'local'): Promise<SavedChain[]> {
  const q = query.trim().toLowerCase()
  const chains = await getAllChains(area)
  if (!q) return chains

  function scoreChain(chain: SavedChain): number {
    let score = 0
    const title = (chain.title || '').toLowerCase()
    if (title === q) score += 120
    else if (title.startsWith(q)) score += 100
    else if (title.includes(q)) score += 80

    const stepText = chain.steps.map((s) => s.content || '').join('\n').toLowerCase()
    if (stepText.includes(q)) score += 50
    return score
  }

  const candidates = chains.filter((chain) => {
    const hay = [chain.title, ...chain.steps.map((s) => s.content)].join('\n').toLowerCase()
    return hay.includes(q)
  })

  return candidates
    .map((chain) => ({ chain, s: scoreChain(chain) }))
    .sort((a, b) => b.s - a.s)
    .map(({ chain }) => chain)
}

export async function exportChains(area: StorageArea = 'local'): Promise<ChainExportFile> {
  const chains = await getAllChains(area)
  return {
    version: 2,
    exportedAt: Date.now(),
    chains,
  }
}

export async function importChains(
  data: unknown,
  options: { mode: ImportMode; duplicateStrategy: DuplicateStrategy },
  area: StorageArea = 'local'
): Promise<{ imported: number; skipped: number; replaced: number; duplicated: number }> {
  if (!data || typeof data !== 'object') throw new Error('Invalid import data')
  const file = data as Partial<ChainExportFile>
  if (typeof file.version !== 'number' || !Array.isArray(file.chains)) throw new Error('Invalid chain export format')

  const envelope = await getChainsEnvelope(area)
  let list = envelope.items
  let imported = 0
  let skipped = 0
  let replaced = 0
  let duplicated = 0

  if (options.mode === 'replace') {
    list = []
  }

  for (const raw of file.chains) {
    const c = normalizeChain(raw)
    if (!c) {
      skipped += 1
      continue
    }

    const idx = list.findIndex((x) => x.id === c.id)
    if (idx >= 0) {
      if (options.duplicateStrategy === 'skip') {
        skipped += 1
        continue
      }
      if (options.duplicateStrategy === 'replace') {
        list[idx] = c
        replaced += 1
        continue
      }
      if (options.duplicateStrategy === 'duplicate') {
        const copy = { ...c, id: `${c.id}_copy_${Date.now()}`, createdAt: Date.now(), updatedAt: Date.now() }
        list.unshift(copy)
        duplicated += 1
        continue
      }
    } else {
      list.unshift(c)
      imported += 1
    }
  }

  await saveChainsEnvelope({ ...envelope, items: list }, area)
  await cleanupUnusedAttachments(area)
  return { imported, skipped, replaced, duplicated }
}

export async function exportLibrary(
  area: StorageArea = 'local',
  options?: { includeBinaries?: boolean }
): Promise<LibraryExportFile> {
  const [promptFile, chainFile] = await Promise.all([exportPrompts(area), exportChains(area)])
  const out: LibraryExportFile = {
    version: 3,
    exportedAt: Date.now(),
    prompts: promptFile.prompts,
    chains: chainFile.chains,
  }

  if (options?.includeBinaries) {
    const attachmentIds = new Set<string>()
    for (const prompt of out.prompts) {
      for (const attachment of prompt.attachments) attachmentIds.add(attachment.id)
    }
    for (const chain of out.chains) {
      for (const step of chain.steps) {
        for (const attachment of step.attachments) attachmentIds.add(attachment.id)
      }
    }
    out.attachments = await exportAttachmentRecords(Array.from(attachmentIds))
  }

  return out
}

type ImportCounts = { imported: number; skipped: number; replaced: number; duplicated: number }

function isLibraryExportFile(input: unknown): input is LibraryExportFile {
  return (
    !!input &&
    typeof input === 'object' &&
    typeof (input as { version?: number }).version === 'number' &&
    Array.isArray((input as { prompts?: unknown[] }).prompts) &&
    Array.isArray((input as { chains?: unknown[] }).chains)
  )
}

function isPromptExportFile(input: unknown): input is PromptExportFile {
  return (
    !!input &&
    typeof input === 'object' &&
    typeof (input as { version?: number }).version === 'number' &&
    Array.isArray((input as { prompts?: unknown[] }).prompts)
  )
}

function isChainExportFile(input: unknown): input is ChainExportFile {
  return (
    !!input &&
    typeof input === 'object' &&
    typeof (input as { version?: number }).version === 'number' &&
    Array.isArray((input as { chains?: unknown[] }).chains)
  )
}

export async function importLibrary(
  data: unknown,
  area: StorageArea = 'local'
): Promise<{ prompts?: ImportCounts; chains?: ImportCounts; attachments?: { imported: number } }> {
  const parsed = typeof data === 'string' ? JSON.parse(data) : data
  const importOptions = { mode: 'merge' as ImportMode, duplicateStrategy: 'replace' as DuplicateStrategy }

  if (isLibraryExportFile(parsed)) {
    const [promptResult, chainResult] = await Promise.all([
      importPrompts(
        { version: parsed.version, exportedAt: parsed.exportedAt, prompts: parsed.prompts },
        importOptions,
        area
      ),
      importChains(
        { version: parsed.version, exportedAt: parsed.exportedAt, chains: parsed.chains },
        importOptions,
        area
      ),
    ])

    let attachmentsImported = 0
    const attachments = Array.isArray(parsed.attachments) ? parsed.attachments as AttachmentExportRecord[] : []
    if (attachments.length > 0 && area === 'local') {
      attachmentsImported = await importAttachmentRecords(attachments)
    }

    await cleanupUnusedAttachments(area)
    return {
      prompts: promptResult,
      chains: chainResult,
      attachments: { imported: attachmentsImported },
    }
  }

  if (isPromptExportFile(parsed)) {
    const prompts = await importPrompts(parsed, importOptions, area)
    return { prompts }
  }

  if (isChainExportFile(parsed)) {
    const chains = await importChains(parsed, importOptions, area)
    return { chains }
  }

  throw new Error('Unrecognized export format. Expected prompts, chains, or combined library export.')
}

export async function getMigrationStatus(area: StorageArea = 'local'): Promise<MigrationStatus | null> {
  const status = await getFromStorage<MigrationStatus>(MIGRATION_STATUS_KEY, area)
  return status ?? null
}

// Expose low-level helpers for future modules
export const _internal = {
  getFromStorage,
  setInStorage,
  removeFromStorage,
  getDB,
  saveDB,
  getChainsEnvelope,
  saveChainsEnvelope,
}
