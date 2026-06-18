import { Handle, Position, type Node, type NodeProps } from '@xyflow/react'
import type { RefreshMode, UiStatus } from '../../types'
import { statusMeta, relativeTime } from '../../lib/format'
import { StatusDot, ModeBadge } from '../StatusBadge'

export interface RmvNodeData extends Record<string, unknown> {
  label: string
  database: string
  mode: RefreshMode
  ui_status: UiStatus
  last_success_time: string | null
  next_refresh_time: string | null
  dimmed: boolean
}

export type RmvFlowNode = Node<RmvNodeData, 'rmv'>

export const NODE_W = 220
export const NODE_H = 84

export function RmvNode({ data, selected }: NodeProps<RmvFlowNode>) {
  const meta = statusMeta(data.ui_status)
  return (
    <div
      style={{ width: NODE_W, height: NODE_H, borderLeftColor: meta.color, opacity: data.dimmed ? 0.25 : 1 }}
      className={`flex flex-col justify-between rounded-lg border border-l-4 bg-slate-800/90 px-3 py-2 shadow-md transition-shadow ${
        selected ? 'border-slate-300 ring-2 ring-slate-300/50' : 'border-slate-700'
      }`}
    >
      <Handle type="target" position={Position.Left} className="!bg-slate-500" />
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1.5">
          <StatusDot status={data.ui_status} />
          <span className="truncate text-sm font-semibold text-slate-100" title={data.label}>
            {data.label}
          </span>
        </div>
        <ModeBadge mode={data.mode} />
      </div>
      <div className="truncate text-[11px] text-slate-400">{data.database}</div>
      <div className="flex justify-between text-[10px] text-slate-500">
        <span title="last successful refresh">✓ {relativeTime(data.last_success_time)}</span>
        <span title="next scheduled refresh">⏭ {relativeTime(data.next_refresh_time)}</span>
      </div>
      <Handle type="source" position={Position.Right} className="!bg-slate-500" />
    </div>
  )
}
