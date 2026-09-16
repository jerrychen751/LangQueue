// Platform
export type Platform =
  | 'chatgpt'
  | 'claude'
  | 'gemini'
  | 'other'

// Attachments
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

// Prompts
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

// Chains
export interface PromptStep {
  content: string
  attachments: AttachmentRef[]
}

export interface PromptChain {
  id: string
  title: string
  steps: PromptStep[]
  createdAt: number
  updatedAt: number
  description?: string
}

// Usage tracking
export interface UsageLog {
  timestamp: number
  platform: Platform
  promptId: string
}

// Storage schemas
export interface PromptsMetadata {
  schemaVersion: number
  createdAt: number
  updatedAt: number
}

export interface PromptsSchema {
  meta: PromptsMetadata
  promptsById: Record<string, Prompt>
}

export interface UsageSchema {
  totalUses: number
  logs: UsageLog[]
}

export interface ChainsEnvelope {
  version: number
  updatedAt: number
  items: PromptChain[]
}

export const CURRENT_SCHEMA_VERSION = 3 as const
export const CURRENT_CHAINS_SCHEMA_VERSION = 2 as const

// Settings
export type ThemePreference = 'light' | 'dark'

export interface AppShortcutsConfig {
  openLibrary?: string
  focusSearch?: string
  createPrompt?: string
}

export interface PageTweaks {
  preventAutoScrollOnSubmit?: boolean
}

export interface AppSettings {
  theme?: ThemePreference
  shortcuts?: AppShortcutsConfig
  insertionMode?: 'overwrite' | 'append'
  tweaks?: PageTweaks
  multimodalEnabled?: boolean
  exportIncludeBinaries?: boolean
}

// Import / Export
export type ImportMode = 'merge' | 'replace'
export type DuplicateStrategy = 'skip' | 'replace' | 'duplicate'

export interface PromptExportFile {
  version: number
  exportedAt: number
  prompts: Prompt[]
}

export interface ChainExportFile {
  version: number
  exportedAt: number
  chains: PromptChain[]
}

export interface LibraryExportFile {
  version: number
  exportedAt: number
  prompts: Prompt[]
  chains: PromptChain[]
  attachments?: AttachmentExportRecord[]
}
