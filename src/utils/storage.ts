import type { DBSchema, DBSchemaV1, Prompt, UsageLog, PromptExportFile, ImportMode, DuplicateStrategy, AppSettings } from '../types'

export type StorageArea = 'local' | 'sync'

const DB_KEY = 'langqueue_db'
const TOTAL_USES_KEY = 'langqueue_total_uses'

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

function now(): number {
  return Date.now()
}

function createEmptyDB(): DBSchemaV1 {
  const ts = now()
  return {
    meta: { schemaVersion: 1, createdAt: ts, updatedAt: ts },
    promptsById: {},
    promptOrder: [],
    foldersById: {},
    usageLogs: [],
  }
}

async function getDB(area: StorageArea = 'local'): Promise<DBSchema> {
  const existing = await getFromStorage<DBSchema>(DB_KEY, area)
  if (!existing) {
    const db = createEmptyDB()
    await setInStorage(DB_KEY, db, area)
    return db
  }
  const migrated = await migrateDB(existing)
  return migrated
}

async function saveDB(db: DBSchema, area: StorageArea = 'local'): Promise<void> {
  db.meta.updatedAt = now()
  await setInStorage(DB_KEY, db, area)
}

// Migrations
export async function migrateDB(db: unknown): Promise<DBSchema> {
  // Current schema is v1. In the future, apply stepwise migrations here.
  if (!db || typeof db !== 'object' || !('meta' in db)) {
    return createEmptyDB()
  }
  const meta = (db as { meta?: { schemaVersion?: number } }).meta
  switch (meta?.schemaVersion) {
    case 1:
      return db as DBSchemaV1
    default:
      return createEmptyDB()
  }
}

// ID helpers
function generateId(prefix: string): string {
  const rand = Math.random().toString(36).slice(2)
  return `${prefix}_${Date.now()}_${rand}`
}

// Prompt operations
export async function savePrompt(prompt: Prompt, area: StorageArea = 'local'): Promise<void> {
  const db = await getDB(area)
  const existing = db.promptsById[prompt.id]
  const ts = now()
  const normalized: Prompt = {
    ...prompt,
    id: prompt.id || generateId('p'),
    tags: prompt.tags ?? [],
    isFavorite: prompt.isFavorite ?? false,
    usageCount: prompt.usageCount ?? 0,
    createdAt: existing?.createdAt ?? prompt.createdAt ?? ts,
    updatedAt: ts,
  }
  db.promptsById[normalized.id] = normalized
  if (!db.promptOrder.includes(normalized.id)) db.promptOrder.unshift(normalized.id)
  await saveDB(db, area)
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
  const ts = now()
  db.promptsById[id] = { ...existing, ...updates, id, updatedAt: ts }
  await saveDB(db, area)
}

export async function searchPrompts(query: string, area: StorageArea = 'local'): Promise<Prompt[]> {
  const q = query.trim().toLowerCase()
  if (!q) return getAllPrompts(area)
  const db = await getDB(area)

  function scorePrompt(p: Prompt): number {
    let score = 0
    const title = (p.title || '').toLowerCase()
    const content = (p.content || '').toLowerCase()
    const description = (p.description || '').toLowerCase()
    const category = (p.category || '').toLowerCase()
    const tags = (p.tags || []).map((t) => t.toLowerCase())

    if (title === q) score += 120
    else if (title.startsWith(q)) score += 100
    else if (title.includes(q)) score += 80

    if (content.includes(q)) score += 50
    if (description.includes(q)) score += 35
    if (category.includes(q)) score += 15
    if (tags.some((t) => t === q)) score += 40
    else if (tags.some((t) => t.includes(q))) score += 25

    if (p.isFavorite) score += 10
    if (p.lastUsedAt) score += 5
    return score
  }

  const candidates = Object.values(db.promptsById).filter((p) => {
    const hay = [p.title, p.description ?? '', p.content, p.category ?? '', ...(p.tags ?? [])]
      .join('\n')
      .toLowerCase()
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
  // Increment global total uses counter independent of prompt lifecycle
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
  // Use persistent total uses if available; seed it on first run
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

// Expose low-level helpers for future modules
export const _internal = {
  getFromStorage,
  setInStorage,
  removeFromStorage,
  getDB,
  saveDB,
}

// Settings helpers
const SETTINGS_KEY = 'langqueue_settings'
export async function getSettings(area: StorageArea = 'local'): Promise<AppSettings> {
  return (await getFromStorage<AppSettings>(SETTINGS_KEY, area)) ?? {}
}

export async function saveSettings(settings: AppSettings, area: StorageArea = 'local'): Promise<void> {
  await setInStorage(SETTINGS_KEY, settings, area)
}

export async function clearAllData(area: StorageArea = 'local'): Promise<void> {
  // Reset the DB to an empty schema and remove settings key entirely
  const empty = createEmptyDB()
  await setInStorage(DB_KEY, empty, area)
  await removeFromStorage(SETTINGS_KEY, area)
  await removeFromStorage(TOTAL_USES_KEY, area)
}

// Export / Import
export async function exportPrompts(area: StorageArea = 'local'): Promise<PromptExportFile> {
  const db = await getDB(area)
  const prompts = Object.values(db.promptsById)
  return {
    version: 1,
    exportedAt: Date.now(),
    prompts,
  }
}

export async function importPrompts(
  data: unknown,
  options: { mode: ImportMode; duplicateStrategy: DuplicateStrategy },
  area: StorageArea = 'local'
): Promise<{ imported: number; skipped: number; replaced: number; duplicated: number }> {
  // Validate
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
    if (!raw || typeof raw !== 'object') {
      skipped++
      continue
    }
    const p = raw as Prompt
    if (!p.id || !p.title || !p.content) {
      skipped++
      continue
    }
    const exists = Boolean(db.promptsById[p.id])
    if (exists) {
      if (options.duplicateStrategy === 'skip') {
        skipped++
        continue
      }
      if (options.duplicateStrategy === 'replace') {
        db.promptsById[p.id] = p
        if (!db.promptOrder.includes(p.id)) db.promptOrder.unshift(p.id)
        replaced++
        continue
      }
      if (options.duplicateStrategy === 'duplicate') {
        const newId = `${p.id}_copy_${Date.now()}`
        const copy = { ...p, id: newId, createdAt: Date.now(), updatedAt: Date.now() }
        db.promptsById[newId] = copy
        db.promptOrder.unshift(newId)
        duplicated++
        continue
      }
    } else {
      db.promptsById[p.id] = p
      db.promptOrder.unshift(p.id)
      imported++
    }
  }

  await saveDB(db, area)
  return { imported, skipped, replaced, duplicated }
}


