export type Platform =
  | 'chatgpt'
  | 'claude'
  | 'gemini'
  | 'perplexity'
  | 'bing'
  | 'poe'
  | 'huggingchat'
  | 'other'

export type AttachmentKind = 'image' | 'file'

export interface AttachmentRef {
  id: string
  name: string
  mimeType: string
  size: number
  kind: AttachmentKind
  createdAt: number
}

export interface AttachmentExportRecord extends AttachmentRef {
  dataBase64: string
}

export interface Prompt {
  id: string
  title: string
  content: string
  attachments: AttachmentRef[]
  usageCount: number
  createdAt: number
  updatedAt: number
  lastUsedAt?: number
}

export interface UsageLog {
  timestamp: number
  platform: Platform
  promptId: string
}

export interface DBSchemaMeta {
  schemaVersion: number
  createdAt: number
  updatedAt: number
}

export interface DBSchema {
  meta: DBSchemaMeta
  promptsById: Record<string, Prompt>
  promptOrder: string[]
  usageLogs: UsageLog[]
}

export const CURRENT_SCHEMA_VERSION = 3 as const
export const CURRENT_CHAINS_SCHEMA_VERSION = 2 as const

export interface MigrationStatus {
  lastMigrationAt: number
  fromVersion: number | null
  toVersion: number
  result: 'ok' | 'recovered_empty'
  reason?: string
  backupKey?: string
}

// App settings and import/export types
export type ThemePreference = 'light' | 'dark'

export interface AppShortcutsConfig {
  openLibrary?: string
  focusSearch?: string
  createPrompt?: string
}

export interface AppSettings {
  theme?: ThemePreference
  shortcuts?: AppShortcutsConfig
  insertionMode?: 'overwrite' | 'append'
  chainDefaults?: ChainDefaults
  tweaks?: PageTweaks
  multimodalEnabled?: boolean
  exportIncludeBinaries?: boolean
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

export interface PageTweaks {
  preventAutoScrollOnSubmit?: boolean
}

export interface PromptSummary {
  id: string
  title: string
  content: string
  attachments: AttachmentRef[]
}

export interface SavedChainStep {
  content: string
  attachments: AttachmentRef[]
  autoSend?: boolean
  awaitResponse?: boolean
  delayMs?: number
}

export interface ChainSummary {
  id: string
  title: string
  steps: SavedChainStep[]
}


export interface SavedChain {
  id: string
  title: string
  steps: SavedChainStep[]
  createdAt: number
  updatedAt: number
  description?: string
}

export interface ChainsEnvelope {
  version: number
  updatedAt: number
  items: SavedChain[]
}

export interface ChainExportFile {
  version: number
  exportedAt: number
  chains: SavedChain[]
}

export interface LibraryExportFile {
  version: number
  exportedAt: number
  prompts: Prompt[]
  chains: SavedChain[]
  attachments?: AttachmentExportRecord[]
}
