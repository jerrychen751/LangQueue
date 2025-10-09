import { useState, useEffect, useMemo, useCallback } from 'react'
import type { Prompt } from '../../types'
import { getAllPrompts, updatePrompt, deletePrompt, logUsage, getUsageStats } from '../../utils/storage'
import { sendPromptToTab } from '../../utils/messaging'
import { useToast } from '../../components/useToast'
import type { SortOption } from '../../components/FilterBar'

export function usePrompts(platform: 'chatgpt' | 'gemini' | 'claude' | 'other', compatible: boolean) {
  const [prompts, setPrompts] = useState<Prompt[]>([])
  const [query, setQuery] = useState('')
  const [favoritesOnly, setFavoritesOnly] = useState(false)
  const [sort, setSort] = useState<SortOption>('recent')
  const [stats, setStats] = useState<{ totalPrompts: number; totalUses: number; mostUsedPrompt: Prompt | null }>({ totalPrompts: 0, totalUses: 0, mostUsedPrompt: null })
  const { showToast } = useToast()

  const refreshPrompts = useCallback(async () => {
    const [items, usageStats] = await Promise.all([
      getAllPrompts('local'),
      getUsageStats('local'),
    ])
    setPrompts(items)
    setStats(usageStats)
  }, [])

  useEffect(() => {
    refreshPrompts()
  }, [refreshPrompts])

  const handleToggleFavorite = useCallback(async (p: Prompt) => {
    await updatePrompt(p.id, { isFavorite: !p.isFavorite }, 'local')
    await refreshPrompts()
  }, [refreshPrompts])

  const handleDeletePrompt = useCallback(async (p: Prompt) => {
    await deletePrompt(p.id, 'local')
    await refreshPrompts()
  }, [refreshPrompts])

  const handleInsertPrompt = useCallback(async (p: Prompt) => {
    try {
      await sendPromptToTab(p.content)
      showToast({ variant: 'success', message: `Inserted into ${platform === 'gemini' ? 'Gemini' : platform === 'claude' ? 'Claude' : 'ChatGPT'}` })
    } catch {
      await navigator.clipboard.writeText(p.content)
      showToast({ variant: 'info', message: 'Copied to clipboard' })
    }
    await logUsage({ timestamp: Date.now(), platform: compatible ? platform : 'other', promptId: p.id }, 'local')
    await refreshPrompts()
    window.close()
  }, [platform, compatible, showToast, refreshPrompts])

  const visiblePrompts = useMemo(() => {
    const q = query.trim().toLowerCase()
    let list = [...prompts]
    if (q) {
      list = list.filter((p) => {
        const hay = [p.title, p.description ?? '', p.content, p.category ?? '', ...(p.tags ?? [])]
          .join('\n')
          .toLowerCase()
        return hay.includes(q)
      })
    }
    if (favoritesOnly) list = list.filter((p) => p.isFavorite)
    switch (sort) {
      case 'alpha':
        list.sort((a, b) => a.title.localeCompare(b.title))
        break
      case 'mostUsed':
        list.sort((a, b) => (b.usageCount ?? 0) - (a.usageCount ?? 0))
        break
      case 'recent':
      default:
        list.sort((a, b) => {
          const byLast = (b.lastUsedAt ?? 0) - (a.lastUsedAt ?? 0)
          if (byLast !== 0) return byLast
          const byUpdated = (b.updatedAt ?? 0) - (a.updatedAt ?? 0)
          if (byUpdated !== 0) return byUpdated
          return (b.createdAt ?? 0) - (a.createdAt ?? 0)
        })
        break
    }
    return list
  }, [prompts, query, favoritesOnly, sort])

  const setFilters = useCallback((filters: { query: string; favoritesOnly: boolean; sort: SortOption }) => {
    setQuery(filters.query)
    setFavoritesOnly(filters.favoritesOnly)
    setSort(filters.sort)
  }, [])

  return {
    prompts,
    stats,
    visiblePrompts,
    refreshPrompts,
    handleToggleFavorite,
    handleDeletePrompt,
    handleInsertPrompt,
    setFilters,
    filters: { query, favoritesOnly, sort }
  }
}