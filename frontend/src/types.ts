// Mirrors the FastAPI backend (backend/clickhouse_client.py).

export type UiStatus =
  | 'ok'
  | 'error'
  | 'running'
  | 'running_other'
  | 'waiting'
  | 'missing'
  | 'disabled'
  | 'scheduling'
  | 'unknown'

export type RefreshMode = 'REPLACE' | 'APPEND'

export interface ViewState {
  database: string
  name: string
  uuid: string | null
  status: string
  ui_status: UiStatus
  mode: RefreshMode
  last_success_time: string | null
  last_success_duration_ms: number | null
  last_refresh_time: string | null
  last_refresh_replica: string | null
  next_refresh_time: string | null
  exception: string
  retry: number | null
  progress: number | null
  read_rows: number | null
  read_bytes: number | null
  total_rows: number | null
  written_rows: number | null
  written_bytes: number | null
}

export interface Schedule {
  kind: 'EVERY' | 'AFTER' | null
  interval: string | null
  offset: string | null
  randomize_for: string | null
  depends_on: string[]
}

export interface ViewDetails extends ViewState {
  create_query: string
  schedule: Schedule
  sources: { database: string; table: string }[]
  consumers: { database: string; name: string }[]
  table_total_rows: number | null
  table_total_bytes: number | null
}

export interface GraphNode {
  id: string
  label: string
  database: string
  mode: RefreshMode
  status: string
  ui_status: UiStatus
  last_success_time: string | null
  next_refresh_time: string | null
  exception: string
}

export interface GraphEdge {
  source: string
  target: string
  type: 'depends_on'
  missing: boolean
}

export interface GraphData {
  nodes: GraphNode[]
  edges: GraphEdge[]
}

export interface HistoryItem {
  event_time: string | null
  duration_ms: number | null
  type: string
  read_rows: number | null
  written_rows: number | null
  memory_usage: number | null
  exception: string
}

export interface History {
  available: boolean
  items: HistoryItem[]
  reason?: string
}

export interface Dashboard {
  total: number
  errors: number
  running: number
  running_other: number
  waiting: number
  disabled: number
  last_success_time: string | null
}

export interface AppConfig {
  display_timezone: string
  poll_interval_seconds: number
  default_databases: string[]
  query_log_cluster: string | null
}
