import type { UiStatus } from '../types'
import { statusMeta } from '../lib/format'
import { Badge } from './ui/badge'

export function StatusDot({ status, size = 10 }: { status: UiStatus; size?: number }) {
  const { color } = statusMeta(status)
  const pulse = status === 'running' || status === 'running_other'
  return (
    <span
      style={{ background: color, width: size, height: size }}
      className={`inline-block rounded-full ${pulse ? 'animate-pulse' : ''}`}
    />
  )
}

export function StatusBadge({ status }: { status: UiStatus }) {
  const { color, label } = statusMeta(status)
  return (
    <Badge style={{ background: `${color}22`, color }}>
      <StatusDot status={status} size={8} />
      {label}
    </Badge>
  )
}

export function ModeBadge({ mode }: { mode: 'REPLACE' | 'APPEND' }) {
  const isAppend = mode === 'APPEND'
  return (
    <Badge
      style={{
        background: isAppend ? '#a855f722' : '#33415555',
        color: isAppend ? '#c084fc' : '#94a3b8',
      }}
      title={isAppend ? 'APPEND mode — manual refresh ADDS rows (possible duplication)' : 'REPLACE mode — refresh atomically replaces data'}
    >
      {mode}
    </Badge>
  )
}
