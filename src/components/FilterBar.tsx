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
    <div className="flex items-center gap-2">
      <div className="relative min-w-0 flex-1">
        <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[#6f7c82]" />
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="search-input h-10 w-full rounded-[4px] py-2 pl-9 pr-3 text-xs"
          placeholder="Find a prompt"
          aria-label="Search prompts"
        />
      </div>
      <select
        value={sort}
        onChange={(e) => setSort(e.target.value as SortOption)}
        className="select-input h-10 w-[112px] rounded-[4px] px-2.5 text-[10px] font-semibold"
        aria-label="Sort prompts"
      >
        <option value="recent">Recent</option>
        <option value="alpha">A–Z</option>
        <option value="mostUsed">Most used</option>
      </select>
      <button className="icon-button h-10 w-10" onClick={clearAll} title="Clear search and sort" aria-label="Clear search and sort">
        <X size={14} />
      </button>
    </div>
  )
}
