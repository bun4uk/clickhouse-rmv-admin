import type {
  AppConfig,
  Dashboard,
  GraphData,
  History,
  ViewDetails,
  ViewState,
} from '../types'

// Same-origin: dev server proxies /api to the backend, prod nginx proxies it.
const BASE = '/api'

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(BASE + path, {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  })
  if (!res.ok) {
    let detail = `${res.status} ${res.statusText}`
    try {
      const body = await res.json()
      if (body?.detail) detail = body.detail
    } catch {
      /* ignore */
    }
    throw new Error(detail)
  }
  return res.json() as Promise<T>
}

const enc = encodeURIComponent

export const api = {
  config: () => req<AppConfig>('/config'),
  health: () => req<{ status: string }>('/health'),
  views: () => req<{ views: ViewState[] }>('/views').then((r) => r.views),
  view: (db: string, name: string) => req<ViewDetails>(`/views/${enc(db)}/${enc(name)}`),
  history: (db: string, name: string, limit = 20) =>
    req<History>(`/views/${enc(db)}/${enc(name)}/history?limit=${limit}`),
  graph: () => req<GraphData>('/graph'),
  dashboard: () => req<Dashboard>('/status'),

  refresh: (db: string, name: string, body: { cascade?: boolean; wait?: boolean }) =>
    req<{ success?: boolean; refreshed?: string[]; errors?: string[]; total?: number }>(
      `/views/${enc(db)}/${enc(name)}/refresh`,
      { method: 'POST', body: JSON.stringify(body) },
    ),
  stop: (db: string, name: string) =>
    req(`/views/${enc(db)}/${enc(name)}/stop`, { method: 'POST' }),
  start: (db: string, name: string) =>
    req(`/views/${enc(db)}/${enc(name)}/start`, { method: 'POST' }),
  cancel: (db: string, name: string) =>
    req(`/views/${enc(db)}/${enc(name)}/cancel`, { method: 'POST' }),
}
