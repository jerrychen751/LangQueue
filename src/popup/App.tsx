import { useEffect, useState, useCallback } from 'react'
import PromptModal from '../components/PromptModal'
import type { Prompt } from '../types'
import ChainBuilder from '../components/ChainBuilder'
import { useToast } from '../components/useToast'
import Settings from './components/Settings'
import Header from './components/Header'
import Footer from './components/Footer'
import MainView from './views/MainView'
import { usePrompts } from './hooks/usePrompts'
import { useChains } from './hooks/useChains'
import { useAppView } from './hooks/useAppView'
import { useCompatibility } from './hooks/useCompatibility'

export default function App() {
  const [loading, setLoading] = useState(true)
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState<Prompt | undefined>(undefined)
  const [chainOpen, setChainOpen] = useState(false)
  const { showToast } = useToast()

  const { view, setView } = useAppView()
  const { compatible, checking, platform } = useCompatibility()
  const {
    prompts,
    stats,
    visiblePrompts,
    refreshPrompts,
    handleToggleFavorite,
    handleDeletePrompt,
    handleInsertPrompt,
    setFilters,
    filters,
  } = usePrompts(platform, compatible)
  const {
    chains,
    refreshChains,
    handleRunChainFromLibrary,
    handleRenameChain,
    handleDeleteChain,
    handleRunChain,
  } = useChains()

  const handleRefresh = useCallback(async () => {
    await Promise.all([
      refreshPrompts(),
      refreshChains(),
    ])
  }, [refreshPrompts, refreshChains])

  useEffect(() => {
    const load = async () => {
      setLoading(true)
      try {
        await handleRefresh()
      } catch (err) {
        console.error('Failed to load data', err)
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [handleRefresh])

  useEffect(() => {
    const handler = (message: { type?: string; payload?: unknown }) => {
      if (message.type === 'CHAIN_PROGRESS') {
        const { stepIndex, totalSteps, status, error } = (message.payload as { stepIndex?: number; totalSteps?: number; status?: string; error?: string }) || {}
        if (!status || typeof stepIndex !== 'number' || typeof totalSteps !== 'number') return
        if (status === 'sending') {
          showToast({ message: `Step ${stepIndex + 1}/${totalSteps} sent` })
        }
        if (status === 'completed' && stepIndex === totalSteps - 1) {
          showToast({ variant: 'success', message: 'Chain completed!' })
        }
        if (status === 'error') {
          showToast({ variant: 'error', message: `Chain error: ${error ?? 'Unknown error'}` })
        }
        if (status === 'cancelled') {
          showToast({ variant: 'info', message: 'Chain cancelled' })
        }
      }
      if (message.type === 'OPEN_NEW_PROMPT') {
        setEditing(undefined)
        setModalOpen(true)
      }
      if (message.type === 'DB_CLEARED' || message.type === 'PROMPTS_IMPORTED') {
        setView('main')
        handleRefresh()
      }
    }
    chrome.runtime.onMessage.addListener(handler)
    return () => chrome.runtime.onMessage.removeListener(handler)
  }, [showToast, handleRefresh, setView])

  useEffect(() => {
    if (view === 'main') {
      handleRefresh()
    }
  }, [view, handleRefresh])

  useEffect(() => {
    if (!chainOpen) {
      handleRefresh()
    }
  }, [chainOpen, handleRefresh])

  const handleCreatePrompt = () => {
    setEditing(undefined)
    setModalOpen(true)
  }

  const handleEditPrompt = (prompt: Prompt) => {
    setEditing(prompt)
    setModalOpen(true)
  }

  return (
    <div className="w-popup min-w-popup max-w-popup h-[600px] bg-white text-gray-900 dark:bg-gray-900 dark:text-gray-100 flex flex-col relative">
      <Header
        view={view}
        onSetView={setView}
        checking={checking}
        compatible={compatible}
        platform={platform}
        filters={filters}
        onFiltersChange={setFilters}
      />

      {view === 'settings' ? (
        <Settings onBack={() => setView('main')} />
      ) : (
        <MainView
          loading={loading}
          prompts={prompts}
          visiblePrompts={visiblePrompts}
          chains={chains}
          compatible={compatible}
          onEditPrompt={handleEditPrompt}
          onDeletePrompt={handleDeletePrompt}
          onInsertPrompt={handleInsertPrompt}
          onToggleFavorite={handleToggleFavorite}
          onRunChain={handleRunChainFromLibrary}
          onRenameChain={handleRenameChain}
          onDeleteChain={handleDeleteChain}
          onNewPrompt={handleCreatePrompt}
        />
      )}

      {loading ? (
        <div className="absolute inset-0 flex items-center justify-center bg-white/80 dark:bg-gray-900/80 z-50">
          <div className="flex flex-col items-center gap-3">
            <div className="h-7 w-7 rounded-full border-2 border-gray-300 dark:border-gray-700 border-t-sky-400 animate-spin" aria-label="Loading" />
            <div className="text-xs font-medium bg-clip-text text-transparent bg-gradient-to-r from-sky-400 via-purple-400 to-pink-400">Loading…</div>
          </div>
        </div>
      ) : null}

      <Footer
        totalPrompts={stats.totalPrompts}
        totalUses={stats.totalUses}
        onNewPrompt={handleCreatePrompt}
        onChainMode={() => setChainOpen(true)}
      />

      <PromptModal
        open={modalOpen}
        initialPrompt={editing}
        onClose={() => setModalOpen(false)}
        onSaved={async () => {
          await handleRefresh()
          setModalOpen(false)
        }}
      />

      <ChainBuilder
        open={chainOpen}
        availablePrompts={prompts}
        onClose={() => setChainOpen(false)}
        onRunChain={async (steps, insertionMode) => {
          await handleRunChain(steps, insertionMode)
          setChainOpen(false)
        }}
      />
    </div>
  )
}