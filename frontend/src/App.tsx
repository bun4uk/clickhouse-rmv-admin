import { useEffect } from 'react'
import { ReactFlowProvider } from '@xyflow/react'
import { Database, Loader2 } from 'lucide-react'
import { useConfig, useGraph } from './api/hooks'
import { setDisplayTimezone } from './lib/format'
import { Dashboard } from './components/Dashboard'
import { Toolbar } from './components/Toolbar'
import { ViewGraph } from './components/graph/ViewGraph'
import { DetailsPanel } from './components/DetailsPanel'
import { Toaster } from './components/Toaster'
import { useStore } from './store'

export default function App() {
  const { data: cfg } = useConfig()
  const { data: graph, isLoading, isError, error } = useGraph()
  const selected = useStore((s) => s.selected)

  useEffect(() => {
    if (cfg?.display_timezone) setDisplayTimezone(cfg.display_timezone)
  }, [cfg?.display_timezone])

  return (
    <div className="flex h-screen flex-col">
      <header className="flex items-center justify-between border-b border-slate-800 px-4 py-3">
        <div className="flex items-center gap-2">
          <Database size={20} className="text-emerald-400" />
          <h1 className="text-sm font-semibold text-slate-100">
            RMV Admin <span className="text-slate-500">· ClickHouse Refreshable MVs</span>
          </h1>
        </div>
        <div className="flex items-center gap-4 text-xs text-slate-400">
          {cfg && <span>TZ: {cfg.display_timezone}</span>}
          <span className="flex items-center gap-1.5">
            <span
              className="inline-block h-2 w-2 rounded-full"
              style={{ background: isError ? '#ef4444' : '#10b981' }}
            />
            {isError ? 'Disconnected' : 'Connected'}
          </span>
        </div>
      </header>

      <div className="border-b border-slate-800 px-4 py-3">
        <Dashboard />
      </div>
      <div className="border-b border-slate-800 px-4 py-2">
        <Toolbar />
      </div>

      <main className="flex min-h-0 flex-1">
        <div className="relative min-w-0 flex-1">
          {isLoading && (
            <div className="flex h-full items-center justify-center text-slate-500">
              <Loader2 className="animate-spin" /> <span className="ml-2">Loading graph…</span>
            </div>
          )}
          {isError && (
            <div className="flex h-full items-center justify-center px-6 text-center text-red-400">
              Failed to load graph: {(error as Error)?.message}. Check the backend / ClickHouse
              connection.
            </div>
          )}
          {!isLoading && !isError && graph && graph.nodes.length === 0 && (
            <div className="flex h-full items-center justify-center text-slate-500">
              No refreshable materialized views found.
            </div>
          )}
          {!isLoading && !isError && graph && graph.nodes.length > 0 && (
            <ReactFlowProvider>
              <ViewGraph data={graph} />
            </ReactFlowProvider>
          )}
        </div>
        {selected && <DetailsPanel />}
      </main>

      <Toaster />
    </div>
  )
}
