import { useEffect, useRef, useState } from 'react'
import { Search, X } from 'lucide-react'

export type SortOption = 'recent' | 'alpha' | 'mostUsed'

type FilterBarProps = {
  initialQuery?: string
  initialSort?: SortOption
  // When true, focus and select the search input on mount
  autoFocus?: boolean
  // Increment this to re-focus and select the input on demand
  focusSignal?: number
  onChange: (s: { query: string; sort: SortOption }) => void
}

export default function FilterBar({ initialQuery = '', initialSort = 'recent', autoFocus = false, focusSignal, onChange }: FilterBarProps) {
  const [query, setQuery] = useState(initialQuery)
  const [debouncedQuery, setDebouncedQuery] = useState(initialQuery)
  const [sort, setSort] = useState<SortOption>(initialSort)
  const inputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(query), 300)
    return () => clearTimeout(t)
  }, [query])

  useEffect(() => {
    onChange({ query: debouncedQuery, sort })
  }, [debouncedQuery, sort, onChange])

  // Focus handling: on mount if autoFocus, and whenever focusSignal changes
  useEffect(() => {
    if (!autoFocus) return
    const el = inputRef.current
    if (el) {
      // Use a rAF to ensure element is in DOM and painted
      requestAnimationFrame(() => {
        el.focus()
        el.select()
      })
    }
  }, [autoFocus])

  useEffect(() => {
    if (typeof focusSignal === 'number') {
      const el = inputRef.current
      if (el) {
        requestAnimationFrame(() => {
          el.focus()
          el.select()
        })
      }
    }
  }, [focusSignal])

  function clearAll() {
    setQuery('')
    setSort('recent')
    // Immediately notify listeners without waiting for debounce
    onChange({ query: '', sort: 'recent' })
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="relative">
        <Search size={16} className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-400" />
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="w-full pl-7 pr-3 py-2 text-sm border rounded-md focus:outline-none focus:ring-2 focus:ring-sky-300 bg-white dark:bg-gray-900 dark:text-gray-100 dark:border-gray-700 placeholder:text-gray-400 dark:placeholder:text-gray-500"
          placeholder="Search prompts"
        />
      </div>
      <div className="flex items-center gap-2 text-xs">
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

