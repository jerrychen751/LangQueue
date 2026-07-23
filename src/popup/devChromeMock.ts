const timestamp = Date.now()

const previewStorage: Record<string, unknown> = {
  langqueue_prompts: {
    meta: {
      schemaVersion: 3,
      createdAt: timestamp,
      updatedAt: timestamp,
    },
    promptsById: {
      'preview-review': {
        id: 'preview-review',
        title: 'Review this change',
        content: 'Review the current changes. Find correctness risks, missing tests, and unclear names.',
        attachments: [],
        usageCount: 18,
        createdAt: timestamp - 5000,
        updatedAt: timestamp - 1000,
        lastUsedAt: timestamp - 1000,
      },
      'preview-explain': {
        id: 'preview-explain',
        title: 'Explain the system',
        content: 'Explain this system from input to output. Name each boundary and the data that crosses it.',
        attachments: [],
        usageCount: 11,
        createdAt: timestamp - 4000,
        updatedAt: timestamp - 2000,
        lastUsedAt: timestamp - 2000,
      },
      'preview-plan': {
        id: 'preview-plan',
        title: 'Create a focused plan',
        content: 'Create a short implementation plan. Include assumptions, risks, and exact verification steps.',
        attachments: [
          {
            id: 'preview-attachment',
            name: 'requirements.md',
            mimeType: 'text/markdown',
            size: 8400,
            kind: 'file',
            createdAt: timestamp - 3000,
          },
        ],
        usageCount: 7,
        createdAt: timestamp - 3000,
        updatedAt: timestamp - 3000,
        lastUsedAt: timestamp - 3000,
      },
    },
  },
  langqueue_chains: {
    version: 2,
    updatedAt: timestamp,
    items: [
      {
        id: 'preview-chain',
        title: 'Audit, revise, verify',
        steps: [
          { content: 'Audit the current result.', attachments: [] },
          { content: 'Revise the weak sections.', attachments: [] },
          { content: 'Verify the final result.', attachments: [] },
        ],
        createdAt: timestamp - 3000,
        updatedAt: timestamp - 1000,
      },
    ],
  },
  langqueue_usage: {
    totalUses: 36,
    logs: [],
  },
  langqueue_settings: {
    insertionMode: 'overwrite',
    multimodalEnabled: true,
  },
}

const runtimeListeners = new Set<(message: unknown) => void>()

function selectStorageValues(keys?: string | string[] | Record<string, unknown> | null): Record<string, unknown> {
  if (keys == null) return { ...previewStorage }
  if (typeof keys === 'string') return { [keys]: previewStorage[keys] }
  if (Array.isArray(keys)) {
    return Object.fromEntries(keys.map((key) => [key, previewStorage[key]]))
  }
  return Object.fromEntries(
    Object.entries(keys).map(([key, fallback]) => [key, previewStorage[key] ?? fallback])
  )
}

export function installDevChromeMock(): void {
  if (globalThis.chrome?.runtime?.onMessage && globalThis.chrome?.storage?.local && globalThis.chrome?.tabs) {
    return
  }

  const mockChrome = {
    runtime: {
      onMessage: {
        addListener(listener: (message: unknown) => void) {
          runtimeListeners.add(listener)
        },
        removeListener(listener: (message: unknown) => void) {
          runtimeListeners.delete(listener)
        },
      },
      async sendMessage(message: unknown) {
        runtimeListeners.forEach((listener) => listener(message))
        return undefined
      },
    },
    storage: {
      local: {
        async get(
          keys?: string | string[] | Record<string, unknown> | null,
          callback?: (items: Record<string, unknown>) => void
        ) {
          const result = selectStorageValues(keys)
          callback?.(result)
          return result
        },
        async set(items: Record<string, unknown>) {
          Object.assign(previewStorage, items)
        },
        async remove(keys: string | string[]) {
          const keysToRemove = Array.isArray(keys) ? keys : [keys]
          keysToRemove.forEach((key) => delete previewStorage[key])
        },
      },
    },
    tabs: {
      query(
        _queryInfo: chrome.tabs.QueryInfo,
        callback: (tabs: chrome.tabs.Tab[]) => void
      ) {
        callback([{ id: 1, url: 'https://chatgpt.com/' } as chrome.tabs.Tab])
      },
      async sendMessage(_tabId: number, message: { type?: string }) {
        if (message.type === 'COMPAT_CHECK') {
          return { type: 'COMPAT_STATUS', payload: { ready: true } }
        }
        if (message.type === 'INJECT_PROMPT') {
          return { type: 'INJECT_PROMPT_RESULT', payload: { ok: true } }
        }
        return undefined
      },
    },
  }

  if (typeof globalThis.chrome === 'undefined') {
    Object.defineProperty(globalThis, 'chrome', {
      configurable: true,
      value: mockChrome as unknown as typeof chrome,
    })
    return
  }

  Object.assign(globalThis.chrome, mockChrome)
}
