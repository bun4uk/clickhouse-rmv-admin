import { useEffect, useMemo, useRef } from 'react'
import {
  Background,
  Controls,
  MarkerType,
  MiniMap,
  ReactFlow,
  useEdgesState,
  useNodesState,
  type Edge,
} from '@xyflow/react'
import dagre from '@dagrejs/dagre'
import type { GraphData } from '../../types'
import { useStore } from '../../store'
import { statusMeta } from '../../lib/format'
import { NODE_H, NODE_W, RmvNode, type RmvFlowNode } from './RmvNode'

const nodeTypes = { rmv: RmvNode }

function layout(data: GraphData): RmvFlowNode[] {
  const g = new dagre.graphlib.Graph()
  g.setDefaultEdgeLabel(() => ({}))
  g.setGraph({ rankdir: 'LR', nodesep: 40, ranksep: 90, marginx: 20, marginy: 20 })
  data.nodes.forEach((n) => g.setNode(n.id, { width: NODE_W, height: NODE_H }))
  data.edges.forEach((e) => {
    if (g.hasNode(e.source) && g.hasNode(e.target)) g.setEdge(e.source, e.target)
  })
  dagre.layout(g)
  return data.nodes.map((n) => {
    const p = g.node(n.id)
    return {
      id: n.id,
      type: 'rmv' as const,
      position: { x: p.x - NODE_W / 2, y: p.y - NODE_H / 2 },
      data: {
        label: n.label,
        database: n.database,
        mode: n.mode,
        ui_status: n.ui_status,
        last_success_time: n.last_success_time,
        next_refresh_time: n.next_refresh_time,
        dimmed: false,
      },
    }
  })
}

export function ViewGraph({ data }: { data: GraphData }) {
  const [nodes, setNodes, onNodesChange] = useNodesState<RmvFlowNode>([])
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([])
  const topoRef = useRef('')

  const select = useStore((s) => s.select)
  const selected = useStore((s) => s.selected)
  const search = useStore((s) => s.search)
  const dbFilter = useStore((s) => s.dbFilter)
  const statusFilter = useStore((s) => s.statusFilter)

  const selectedId = selected ? `${selected.database}.${selected.name}` : null

  const matches = useMemo(() => {
    const q = search.trim().toLowerCase()
    return (n: { id: string; label: string; database: string; ui_status: string }) => {
      if (q && !n.label.toLowerCase().includes(q) && !n.id.toLowerCase().includes(q)) return false
      if (dbFilter && n.database !== dbFilter) return false
      if (statusFilter && n.ui_status !== statusFilter) return false
      return true
    }
  }, [search, dbFilter, statusFilter])

  useEffect(() => {
    if (!data) return
    const signature = [
      ...data.nodes.map((n) => n.id).sort(),
      '|',
      ...data.edges.map((e) => `${e.source}->${e.target}`).sort(),
    ].join(',')

    const nodeById = new Map(data.nodes.map((n) => [n.id, n]))

    const styleEdges = (): Edge[] =>
      data.edges.map((e) => {
        const srcN = nodeById.get(e.source)
        const tgtN = nodeById.get(e.target)
        const dim = Boolean((srcN && !matches(srcN)) || (tgtN && !matches(tgtN)))
        const color = e.missing ? '#ef4444' : '#64748b'
        return {
          id: `${e.source}->${e.target}`,
          source: e.source,
          target: e.target,
          style: {
            stroke: color,
            strokeDasharray: e.missing ? '6 4' : undefined,
            opacity: dim ? 0.15 : 0.9,
          },
          markerEnd: { type: MarkerType.ArrowClosed, color },
          label: e.missing ? 'missing' : undefined,
          labelStyle: { fill: '#ef4444', fontSize: 10 },
        }
      })

    if (signature !== topoRef.current) {
      topoRef.current = signature
      const laid = layout(data).map((n) => ({
        ...n,
        selected: n.id === selectedId,
        data: { ...n.data, dimmed: !matches(nodeById.get(n.id) as any) },
      }))
      setNodes(laid)
      setEdges(styleEdges())
    } else {
      setNodes((prev) =>
        prev.map((n) => {
          const fresh = nodeById.get(n.id)
          if (!fresh) return n
          return {
            ...n,
            selected: n.id === selectedId,
            data: {
              ...n.data,
              mode: fresh.mode,
              ui_status: fresh.ui_status,
              last_success_time: fresh.last_success_time,
              next_refresh_time: fresh.next_refresh_time,
              dimmed: !matches(fresh),
            },
          }
        }),
      )
      setEdges(styleEdges())
    }
  }, [data, matches, selectedId, setNodes, setEdges])

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      onNodesChange={onNodesChange}
      onEdgesChange={onEdgesChange}
      onNodeClick={(_, node) => {
        const [database, ...rest] = node.id.split('.')
        select(database, rest.join('.'))
      }}
      onPaneClick={() => useStore.getState().clearSelection()}
      fitView
      minZoom={0.2}
      proOptions={{ hideAttribution: true }}
      colorMode="dark"
    >
      <Background color="#1e293b" gap={20} />
      <Controls className="!bg-slate-800 !border-slate-700" />
      <MiniMap
        pannable
        zoomable
        nodeColor={(n) => statusMeta((n.data as any).ui_status).color}
        maskColor="rgba(2,6,23,0.7)"
        className="!bg-slate-900"
      />
    </ReactFlow>
  )
}
