import { useMemo, useState, type ReactNode } from 'react'
import {
  ChevronRight,
  Play,
  RefreshCw,
  Square,
  X,
  XCircle,
} from 'lucide-react'
import { format as formatSql } from 'sql-formatter'
import { useHistory, useView, useViewActions } from '../api/hooks'
import { useStore } from '../store'
import {
  formatBytes,
  formatDuration,
  formatNumber,
  formatTime,
  relativeTime,
} from '../lib/format'
import { ModeBadge, StatusBadge } from './StatusBadge'
import { Button } from './ui/button'
import { RefreshDialog } from './RefreshDialog'

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex justify-between gap-3 py-1 text-sm">
      <span className="shrink-0 text-slate-500">{label}</span>
      <span className="min-w-0 break-words text-right text-slate-200">{children}</span>
    </div>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="border-t border-slate-800 px-4 py-3">
      <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
        {title}
      </div>
      {children}
    </div>
  )
}

export function DetailsPanel() {
  const selected = useStore((s) => s.selected)
  const clear = useStore((s) => s.clearSelection)
  const select = useStore((s) => s.select)
  const { data: view, isLoading } = useView(selected?.database ?? null, selected?.name ?? null)
  const { data: history } = useHistory(selected?.database ?? null, selected?.name ?? null)
  const { refresh, stop, start, cancel } = useViewActions()
  const [refreshOpen, setRefreshOpen] = useState(false)
  const [showDdl, setShowDdl] = useState(false)

  const prettyDdl = useMemo(() => {
    if (!view?.create_query) return ''
    try {
      return formatSql(view.create_query, { language: 'sql' })
    } catch {
      return view.create_query
    }
  }, [view?.create_query])

  if (!selected) return null

  const busy = refresh.isPending || stop.isPending || start.isPending || cancel.isPending
  const arg = { db: selected.database, name: selected.name }
  const isRunning = view?.ui_status === 'running' || view?.ui_status === 'running_other'
  const isDisabled = view?.ui_status === 'disabled'

  return (
    <aside className="flex h-full w-[420px] shrink-0 flex-col border-l border-slate-800 bg-slate-900/80">
      {/* header */}
      <div className="flex items-start justify-between gap-2 px-4 py-3">
        <div className="min-w-0">
          <div className="truncate text-base font-semibold text-slate-100">
            {selected.database}.{selected.name}
          </div>
          {view?.uuid && <div className="truncate font-mono text-[11px] text-slate-500">{view.uuid}</div>}
          <div className="mt-1.5 flex items-center gap-1.5">
            {view && <StatusBadge status={view.ui_status} />}
            {view && <ModeBadge mode={view.mode} />}
          </div>
        </div>
        <button onClick={clear} className="text-slate-500 hover:text-slate-200">
          <X size={18} />
        </button>
      </div>

      {/* actions */}
      <div className="flex flex-wrap gap-2 px-4 pb-3">
        <Button size="sm" variant="primary" disabled={busy || !view} onClick={() => setRefreshOpen(true)}>
          <RefreshCw size={14} className={refresh.isPending ? 'animate-spin' : ''} /> Refresh
        </Button>
        {isDisabled ? (
          <Button size="sm" variant="outline" disabled={busy} onClick={() => start.mutate(arg)}>
            <Play size={14} /> Start
          </Button>
        ) : (
          <Button size="sm" variant="outline" disabled={busy} onClick={() => stop.mutate(arg)}>
            <Square size={14} /> Stop
          </Button>
        )}
        <Button size="sm" variant="ghost" disabled={busy || !isRunning} onClick={() => cancel.mutate(arg)}>
          <XCircle size={14} /> Cancel
        </Button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {isLoading && <div className="p-4 text-sm text-slate-500">Loading…</div>}
        {view && (
          <>
            <Section title="State">
              <Row label="Raw status">
                <span className="font-mono">{view.status}</span>
              </Row>
              <Row label="Last success">
                {formatTime(view.last_success_time)}{' '}
                <span className="text-slate-500">({relativeTime(view.last_success_time)})</span>
              </Row>
              <Row label="Last duration">{formatDuration(view.last_success_duration_ms)}</Row>
              <Row label="Last refresh">{formatTime(view.last_refresh_time)}</Row>
              {view.last_refresh_replica && <Row label="Replica">{view.last_refresh_replica}</Row>}
              <Row label="Next refresh">
                {formatTime(view.next_refresh_time)}{' '}
                <span className="text-slate-500">({relativeTime(view.next_refresh_time)})</span>
              </Row>
              <Row label="Retries">{view.retry ?? 0}</Row>
              <Row label="Storage">
                {formatNumber(view.table_total_rows)} rows · {formatBytes(view.table_total_bytes)}
              </Row>
            </Section>

            {isRunning && (
              <Section title="Progress">
                {view.ui_status === 'running_other' ? (
                  <div className="text-sm text-slate-400">
                    Running on another replica{view.last_refresh_replica ? ` (${view.last_refresh_replica})` : ''} —
                    progress metrics are not available locally.
                  </div>
                ) : (
                  <>
                    <div className="h-2 w-full overflow-hidden rounded bg-slate-800">
                      <div
                        className="h-full bg-amber-500 transition-all"
                        style={{ width: `${Math.round((view.progress ?? 0) * 100)}%` }}
                      />
                    </div>
                    <div className="mt-1.5 flex justify-between text-[11px] text-slate-500">
                      <span>{Math.round((view.progress ?? 0) * 100)}%</span>
                      <span>
                        read {formatNumber(view.read_rows)}
                        {view.total_rows ? ` / ${formatNumber(view.total_rows)}` : ''} · written{' '}
                        {formatNumber(view.written_rows)}
                      </span>
                    </div>
                  </>
                )}
              </Section>
            )}

            {view.exception && (
              <Section title="Exception (last attempt)">
                <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-words rounded bg-red-500/10 p-2 text-[11px] text-red-300">
                  {view.exception}
                </pre>
              </Section>
            )}

            <Section title="Refresh policy">
              <Row label="Mode">{view.schedule.kind ?? '—'}</Row>
              <Row label="Interval">{view.schedule.interval ?? '—'}</Row>
              {view.schedule.offset && <Row label="Offset">{view.schedule.offset}</Row>}
              {view.schedule.randomize_for && <Row label="Randomize for">{view.schedule.randomize_for}</Row>}
              {view.schedule.depends_on.length > 0 && (
                <Row label="Depends on">{view.schedule.depends_on.join(', ')}</Row>
              )}
            </Section>

            <Section title={`Sources (${view.sources.length})`}>
              {view.sources.length === 0 ? (
                <div className="text-sm text-slate-500">No DEPENDS ON sources</div>
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  {view.sources.map((s) => (
                    <Chip key={`${s.database}.${s.table}`} onClick={() => select(s.database, s.table)}>
                      {s.database}.{s.table}
                    </Chip>
                  ))}
                </div>
              )}
            </Section>

            <Section title={`Consumers (${view.consumers.length})`}>
              {view.consumers.length === 0 ? (
                <div className="text-sm text-slate-500">No views depend on this one</div>
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  {view.consumers.map((c) => (
                    <Chip key={`${c.database}.${c.name}`} onClick={() => select(c.database, c.name)}>
                      {c.database}.{c.name}
                    </Chip>
                  ))}
                </div>
              )}
            </Section>

            <Section title="History (from query_log)">
              {!history ? (
                <div className="text-sm text-slate-500">Loading…</div>
              ) : !history.available ? (
                <div className="text-sm text-slate-500">History unavailable ({history.reason})</div>
              ) : history.items.length === 0 ? (
                <div className="text-sm text-slate-500">No refreshes recorded yet</div>
              ) : (
                <div className="space-y-1">
                  {history.items.map((h, i) => {
                    const failed = h.type !== 'QueryFinish'
                    return (
                      <div
                        key={i}
                        className="flex items-center justify-between gap-2 rounded border border-slate-800 px-2 py-1 text-[11px]"
                        title={h.exception || undefined}
                      >
                        <span className="text-slate-400">{formatTime(h.event_time)}</span>
                        <span className="flex items-center gap-2">
                          <span className="text-slate-500">{formatDuration(h.duration_ms)}</span>
                          <span className="text-slate-500">{formatNumber(h.written_rows)} rows</span>
                          <span
                            className="rounded px-1.5 py-0.5"
                            style={{
                              background: failed ? '#ef444422' : '#10b98122',
                              color: failed ? '#fca5a5' : '#6ee7b7',
                            }}
                          >
                            {failed ? 'failed' : 'ok'}
                          </span>
                        </span>
                      </div>
                    )
                  })}
                </div>
              )}
            </Section>

            <Section title="DDL">
              <button
                onClick={() => setShowDdl((v) => !v)}
                className="flex items-center gap-1 text-sm text-slate-400 hover:text-slate-200"
              >
                <ChevronRight size={14} className={showDdl ? 'rotate-90 transition-transform' : 'transition-transform'} />
                {showDdl ? 'Hide' : 'Show'} CREATE query
              </button>
              {showDdl && (
                <pre className="mt-2 max-h-72 overflow-auto rounded bg-slate-950 p-2 text-[11px] leading-relaxed text-slate-300">
                  {prettyDdl}
                </pre>
              )}
            </Section>
          </>
        )}
      </div>

      {view && (
        <RefreshDialog
          view={view}
          open={refreshOpen}
          onOpenChange={setRefreshOpen}
          onConfirm={({ cascade, wait }) => refresh.mutate({ ...arg, cascade, wait })}
        />
      )}
    </aside>
  )
}

function Chip({ children, onClick }: { children: ReactNode; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="rounded-md border border-slate-700 bg-slate-800/60 px-2 py-1 text-[11px] text-slate-300 hover:border-slate-500 hover:text-slate-100"
    >
      {children}
    </button>
  )
}
