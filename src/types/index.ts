export type Platform =
  | 'chatgpt'
  | 'claude'
  | 'gemini'
  | 'perplexity'
  | 'bing'
  | 'poe'
  | 'huggingchat'
  | 'other'

export interface Prompt {
  id: string
  title: string
  content: string
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
  schemaVersion: 2
  createdAt: number
  updatedAt: number
}

export interface DBSchema {
  meta: DBSchemaMeta
  promptsById: Record<string, Prompt>
  promptOrder: string[]
  usageLogs: UsageLog[]
}

export const CURRENT_SCHEMA_VERSION = 2 as const

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
}

export interface ChainSummary {
  id: string
  title: string
  steps: { content: string }[]
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
