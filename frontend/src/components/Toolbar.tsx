import { Search, X } from 'lucide-react'
import { useStore } from '../store'
import { useConfig, useGraph } from '../api/hooks'
import { STATUS_META } from '../lib/format'
import type { UiStatus } from '../types'

const FILTERABLE: UiStatus[] = [
  'ok',
  'error',
  'running',
  'running_other',
  'waiting',
  'missing',
  'disabled',
]

export function Toolbar() {
  const { search, setSearch, dbFilter, setDbFilter, statusFilter, setStatusFilter } = useStore()
  const { data: cfg } = useConfig()
  const { data: graph } = useGraph()

  const databases =
    cfg?.default_databases?.length
      ? cfg.default_databases
      : Array.from(new Set((graph?.nodes ?? []).map((n) => n.database))).sort()

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="relative">
        <Search size={15} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500" />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search views…"
          className="h-9 w-56 rounded-md border border-slate-700 bg-slate-900 pl-8 pr-3 text-sm text-slate-200 placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-slate-500/40"
        />
        {search && (
          <button
            onClick={() => setSearch('')}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-200"
          >
            <X size={14} />
          </button>
        )}
      </div>

      <select
        value={dbFilter ?? ''}
        onChange={(e) => setDbFilter(e.target.value || null)}
        className="h-9 rounded-md border border-slate-700 bg-slate-900 px-2 text-sm text-slate-200 focus:outline-none"
      >
        <option value="">All databases</option>
        {databases.map((db) => (
          <option key={db} value={db}>
            {db}
          </option>
        ))}
      </select>

      <select
        value={statusFilter ?? ''}
        onChange={(e) => setStatusFilter((e.target.value || null) as UiStatus | null)}
        className="h-9 rounded-md border border-slate-700 bg-slate-900 px-2 text-sm text-slate-200 focus:outline-none"
      >
        <option value="">All statuses</option>
        {FILTERABLE.map((s) => (
          <option key={s} value={s}>
            {STATUS_META[s].label}
          </option>
        ))}
      </select>

      {(search || dbFilter || statusFilter) && (
        <button
          onClick={() => {
            setSearch('')
            setDbFilter(null)
            setStatusFilter(null)
          }}
          className="h-9 rounded-md px-2 text-sm text-slate-400 hover:text-slate-100"
        >
          Clear
        </button>
      )}
    </div>
  )
}
