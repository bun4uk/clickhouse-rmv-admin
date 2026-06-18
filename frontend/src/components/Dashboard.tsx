import type { ReactNode } from 'react'
import { Activity, AlertTriangle, Clock, Database, Loader2, Pause } from 'lucide-react'
import { useDashboard } from '../api/hooks'
import { relativeTime } from '../lib/format'

function Stat({
  icon,
  label,
  value,
  color,
  title,
}: {
  icon: ReactNode
  label: string
  value: ReactNode
  color?: string
  title?: string
}) {
  return (
    <div
      className="flex items-center gap-3 rounded-lg border border-slate-800 bg-slate-900/60 px-4 py-2"
      title={title}
    >
      <div style={{ color: color ?? '#94a3b8' }}>{icon}</div>
      <div className="leading-tight">
        <div className="text-lg font-semibold text-slate-100" style={{ color }}>
          {value}
        </div>
        <div className="text-[11px] uppercase tracking-wide text-slate-500">{label}</div>
      </div>
    </div>
  )
}

export function Dashboard() {
  const { data } = useDashboard()
  const d = data

  return (
    <div className="flex flex-wrap gap-3">
      <Stat icon={<Database size={20} />} label="Total RMV" value={d?.total ?? '—'} />
      <Stat
        icon={<AlertTriangle size={20} />}
        label="Errors"
        value={d?.errors ?? '—'}
        color={d && d.errors > 0 ? '#ef4444' : undefined}
        title="Views whose last refresh failed (exception != '')"
      />
      <Stat
        icon={<Loader2 size={20} />}
        label="Running"
        value={d ? d.running + d.running_other : '—'}
        color={d && d.running + d.running_other > 0 ? '#f59e0b' : undefined}
        title="Running locally + on another replica"
      />
      <Stat
        icon={<Activity size={20} />}
        label="Waiting deps"
        value={d?.waiting ?? '—'}
        color={d && d.waiting > 0 ? '#3b82f6' : undefined}
        title="WaitingForDependencies + MissingDependencies"
      />
      <Stat
        icon={<Pause size={20} />}
        label="Stopped"
        value={d?.disabled ?? '—'}
        color={d && d.disabled > 0 ? '#6b7280' : undefined}
      />
      <Stat
        icon={<Clock size={20} />}
        label="Last success"
        value={<span className="text-sm">{relativeTime(d?.last_success_time ?? null)}</span>}
      />
    </div>
  )
}
