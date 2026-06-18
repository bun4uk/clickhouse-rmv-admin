import type { UiStatus } from '../types'

export interface StatusMeta {
  label: string
  color: string // hex, applied via inline style (Tailwind can't see dynamic classes)
}

export const STATUS_META: Record<UiStatus, StatusMeta> = {
  ok: { label: 'OK', color: '#10b981' },
  error: { label: 'Error', color: '#ef4444' },
  running: { label: 'Running', color: '#f59e0b' },
  running_other: { label: 'On another replica', color: '#a855f7' },
  waiting: { label: 'Waiting for deps', color: '#3b82f6' },
  missing: { label: 'Missing deps', color: '#3b82f6' },
  disabled: { label: 'Stopped', color: '#6b7280' },
  scheduling: { label: 'Scheduling', color: '#9ca3af' },
  unknown: { label: 'Unknown', color: '#9ca3af' },
}

export function statusMeta(s: UiStatus): StatusMeta {
  return STATUS_META[s] ?? STATUS_META.unknown
}

let TZ = 'UTC'
export function setDisplayTimezone(tz: string) {
  TZ = tz || 'UTC'
}
export function displayTimezone() {
  return TZ
}

export function formatTime(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (isNaN(d.getTime())) return '—'
  try {
    return new Intl.DateTimeFormat('en-GB', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      timeZone: TZ,
    }).format(d)
  } catch {
    return d.toISOString()
  }
}

export function relativeTime(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (isNaN(d.getTime())) return '—'
  const diff = Date.now() - d.getTime()
  const abs = Math.abs(diff)
  const min = 60_000
  const hour = 60 * min
  const day = 24 * hour
  const suffix = diff >= 0 ? 'ago' : 'from now'
  if (abs < min) return 'just now'
  if (abs < hour) return `${Math.round(abs / min)}m ${suffix}`
  if (abs < day) return `${Math.round(abs / hour)}h ${suffix}`
  return `${Math.round(abs / day)}d ${suffix}`
}

export function formatDuration(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) return '—'
  if (ms < 1000) return `${ms} ms`
  const s = ms / 1000
  if (s < 60) return `${s.toFixed(s < 10 ? 2 : 1)} s`
  const m = Math.floor(s / 60)
  return `${m}m ${Math.round(s % 60)}s`
}

export function formatNumber(n: number | null | undefined): string {
  if (n === null || n === undefined) return '—'
  return n.toLocaleString('en-US')
}

export function formatBytes(n: number | null | undefined): string {
  if (n === null || n === undefined) return '—'
  if (n === 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(n) / Math.log(1024))
  return `${(n / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1)} ${units[i]}`
}
