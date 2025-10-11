export type Platform =
  | 'chatgpt'
  | 'claude'
  | 'gemini'
  | 'perplexity'
  | 'bing'
  | 'poe'
  | 'huggingchat'
  | 'other'

export interface Folder {
  id: string
  name: string
  parentId?: string | null
  color?: string | null
  createdAt: number
  updatedAt: number
}

export interface Prompt {
  id: string
  title: string
  content: string
  description?: string
  category?: string
  tags: string[]
  isFavorite: boolean
  usageCount: number
  folderId?: string | null
  rating?: number | null
  createdAt: number
  updatedAt: number
  lastUsedAt?: number
  modelHints?: string[]
  version?: number
}

export interface UsageLog {
  timestamp: number
  platform: Platform
  promptId: string
}

export interface DBSchemaMetaV1 {
  schemaVersion: 1
  createdAt: number
  updatedAt: number
}

export interface DBSchemaV1 {
  meta: DBSchemaMetaV1
  promptsById: Record<string, Prompt>
  promptOrder: string[]
  foldersById: Record<string, Folder>
  usageLogs: UsageLog[]
}

export type DBSchema = DBSchemaV1

export const CURRENT_SCHEMA_VERSION = 1 as const

// App settings and import/export types
export type ThemePreference = 'light' | 'dark'

export interface AppShortcutsConfig {
  openLibrary?: string
  focusSearch?: string
  createPrompt?: string
  // Legacy key for backward compatibility with older saved settings
  savePrompt?: string
}

export interface AppSettings {
  theme?: ThemePreference
  shortcuts?: AppShortcutsConfig
  insertionMode?: 'overwrite' | 'append'
  chainDefaults?: ChainDefaults
}

export interface PromptExportFile {
  version: number
  exportedAt: number
  prompts: Prompt[]
}

export type ImportMode = 'merge' | 'replace'
export type DuplicateStrategy = 'skip' | 'replace' | 'duplicate'


export interface ChainDefaults {
  autoSend?: boolean
  awaitResponse?: boolean
  defaultDelayMs?: number
}


export interface SavedChain {
  id: string
  title: string
  steps: { content: string }[]
  createdAt: number
  updatedAt: number
  description?: string
}

export interface ChainExportFile {
  version: number
  exportedAt: number
  chains: SavedChain[]
}


