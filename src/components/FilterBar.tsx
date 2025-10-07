import { useEffect, useState } from 'react'
import { Search, Star, X } from 'lucide-react'

export type SortOption = 'recent' | 'alpha' | 'mostUsed'

type FilterBarProps = {
  initialQuery?: string
  initialFavoritesOnly?: boolean
  initialSort?: SortOption
  onChange: (s: { query: string; favoritesOnly: boolean; sort: SortOption }) => void
}

export default function FilterBar({ initialQuery = '', initialFavoritesOnly = false, initialSort = 'recent', onChange }: FilterBarProps) {
  const [query, setQuery] = useState(initialQuery)
  const [debouncedQuery, setDebouncedQuery] = useState(initialQuery)
  const [favoritesOnly, setFavoritesOnly] = useState(initialFavoritesOnly)
  const [sort, setSort] = useState<SortOption>(initialSort)

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(query), 300)
    return () => clearTimeout(t)
  }, [query])

  useEffect(() => {
    onChange({ query: debouncedQuery, favoritesOnly, sort })
  }, [debouncedQuery, favoritesOnly, sort, onChange])

  function clearAll() {
    setQuery('')
    setFavoritesOnly(false)
    setSort('recent')
    // Immediately notify listeners without waiting for debounce
    onChange({ query: '', favoritesOnly: false, sort: 'recent' })
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="relative">
        <Search size={16} className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-400" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="w-full pl-7 pr-3 py-2 text-sm border rounded-md focus:outline-none focus:ring-2 focus:ring-sky-300 bg-white dark:bg-gray-900 dark:text-gray-100 dark:border-gray-700 placeholder:text-gray-400 dark:placeholder:text-gray-500"
          placeholder="Search prompts"
        />
      </div>
      <div className="flex items-center gap-2 text-xs">
        <label className="inline-flex items-center gap-2 px-2 py-1 border rounded-md cursor-pointer bg-white/5 dark:bg-white/5 backdrop-blur-sm hover:bg-white/10 dark:hover:bg-white/10 border-white/10 dark:border-white/10">
          <input
            type="checkbox"
            className="h-4 w-4 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 accent-sky-600 dark:accent-sky-400"
            checked={favoritesOnly}
            onChange={(e) => setFavoritesOnly(e.target.checked)}
          />
          <Star size={12} className={favoritesOnly ? 'text-amber-500' : 'text-gray-400'} />
          Favorites only
        </label>
        <select
          value={sort}
          onChange={(e) => setSort(e.target.value as SortOption)}
          className="px-2 py-1 border rounded-md bg-white dark:bg-gray-900 dark:text-gray-100 dark:border-gray-700"
        >
          <option value="recent">Recently used</option>
          <option value="alpha">Alphabetical</option>
          <option value="mostUsed">Most used</option>
        </select>
        <button className="ml-auto inline-flex items-center gap-1 px-2 py-1 rounded-md bg-white/5 dark:bg-white/5 border border-white/10 dark:border-white/10 backdrop-blur-sm hover:bg-white/10 dark:hover:bg-white/10" onClick={clearAll}>
          <X size={12} />
          Clear
        </button>
      </div>
    </div>
  )
}


