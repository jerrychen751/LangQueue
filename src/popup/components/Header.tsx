import { ArrowLeft, Settings as SettingsIcon } from 'lucide-react'
import Logo from '../../components/Logo'
import FilterBar from '../../components/FilterBar'
import type { SortOption } from '../../components/FilterBar'
import type { Platform } from '../hooks/useCompatibility'
import type { AppView } from '../hooks/useAppView'

interface HeaderProps {
  view: AppView
  onSetView: (view: AppView) => void
  checking: boolean
  compatible: boolean
  platform: Platform
  filters: {
    query: string
    favoritesOnly: boolean
    sort: SortOption
  }
  onFiltersChange: (filters: { query: string; favoritesOnly: boolean; sort: SortOption }) => void
}

export default function Header({ view, onSetView, checking, compatible, platform, filters, onFiltersChange }: HeaderProps) {
  return (
    <header className="border-b bg-gradient-to-r from-gray-900 via-gray-800 to-gray-900">
      <div className="flex items-center gap-2 p-3">
        {view === 'settings' ? (
          <button className="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-800" onClick={() => onSetView('main')} aria-label="Back">
            <ArrowLeft size={16} />
          </button>
        ) : null}
        <Logo size={18} ariaLabel="LangQueue" className="shrink-0" />
        <div className="font-medium bg-clip-text text-transparent bg-gradient-to-r from-sky-400 via-purple-400 to-pink-400">LangQueue</div>
        <div className="ml-auto flex items-center gap-2 text-xs" title={checking ? 'Detecting compatibility…' : compatible ? `Ready on ${platform === 'gemini' ? 'Gemini' : platform === 'claude' ? 'Claude' : platform === 'chatgpt' ? 'ChatGPT' : 'this page'}` : 'Not detected on current tab'}>
          <span
            className={`inline-block w-2 h-2 rounded-full ${checking ? 'bg-gray-300 dark:bg-gray-700 animate-pulse' : compatible ? 'bg-emerald-500' : 'bg-gray-300 dark:bg-gray-700'}`}
            aria-hidden
          />
          <span className={compatible ? 'text-emerald-700 dark:text-emerald-300' : 'text-gray-500 dark:text-gray-400'}>
            {checking ? 'Detecting…' : compatible ? (platform === 'gemini' ? 'Gemini detected' : platform === 'claude' ? 'Claude detected' : platform === 'chatgpt' ? 'ChatGPT detected' : 'Detected') : 'Open ChatGPT, Gemini, or Claude to enable Insert'}
          </span>
          {view === 'main' ? (
            <button className="ml-2 p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-800" onClick={() => onSetView('settings')} aria-label="Settings">
              <SettingsIcon size={16} />
            </button>
          ) : null}
        </div>
      </div>
      <div className="px-3 pb-3">
        {view === 'main' ? (
          <FilterBar
            initialQuery={filters.query}
            initialFavoritesOnly={filters.favoritesOnly}
            initialSort={filters.sort}
            onChange={onFiltersChange}
          />
        ) : (
          <div className="text-xs text-gray-500 dark:text-gray-400">Configure settings below.</div>
        )}
      </div>
    </header>
  )
}