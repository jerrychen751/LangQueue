import { useState, useEffect, useCallback } from 'react'
import type { SavedChain } from '../../types'
import { getAllChains, saveChain, deleteChain } from '../../utils/storage'
import { runChainOnTab } from '../../utils/messaging'
import { useToast } from '../../components/useToast'
import type { ChainStep } from '../../types/messages'

export function useChains() {
  const [chains, setChains] = useState<SavedChain[]>([])
  const { showToast } = useToast()

  const refreshChains = useCallback(async () => {
    const savedChains = await getAllChains('local')
    setChains(savedChains)
  }, [])

  useEffect(() => {
    refreshChains()
  }, [refreshChains])

  const handleRunChainFromLibrary = useCallback(async (chain: SavedChain) => {
    const steps = chain.steps.map((s) => ({ content: s.content, autoSend: true, awaitResponse: true, delayMs: 500 }))
    try {
      await runChainOnTab(steps, 'overwrite')
      showToast({ variant: 'success', message: 'Chain started' })
      window.close()
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to start chain'
      showToast({ variant: 'error', message })
    }
  }, [showToast])

  const handleRenameChain = useCallback(async (chain: SavedChain) => {
    const nextTitle = prompt('Rename chain', chain.title)?.trim()
    if (!nextTitle) return
    const updated: SavedChain = { ...chain, title: nextTitle, updatedAt: Date.now() }
    await saveChain(updated, 'local')
    await refreshChains()
  }, [refreshChains])

  const handleDeleteChain = useCallback(async (chain: SavedChain) => {
    if (!confirm('Delete this chain?')) return
    await deleteChain(chain.id, 'local')
    await refreshChains()
  }, [refreshChains])

  const handleRunChain = useCallback(async (steps: ChainStep[], insertionMode: 'overwrite' | 'append') => {
    try {
      await runChainOnTab(steps, insertionMode)
      showToast({ variant: 'success', message: 'Chain started' })
      window.close()
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to start chain'
      showToast({ variant: 'error', message })
    }
  }, [showToast])

  return {
    chains,
    refreshChains,
    handleRunChainFromLibrary,
    handleRenameChain,
    handleDeleteChain,
    handleRunChain,
  }
}