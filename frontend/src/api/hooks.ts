import {
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'
import { api } from './client'
import { useStore } from '../store'

function usePollMs() {
  const { data } = useConfig()
  return (data?.poll_interval_seconds ?? 15) * 1000
}

export function useConfig() {
  return useQuery({ queryKey: ['config'], queryFn: api.config, staleTime: Infinity })
}

export function useGraph() {
  const pollMs = usePollMs()
  return useQuery({ queryKey: ['graph'], queryFn: api.graph, refetchInterval: pollMs })
}

export function useDashboard() {
  const pollMs = usePollMs()
  return useQuery({ queryKey: ['dashboard'], queryFn: api.dashboard, refetchInterval: pollMs })
}

export function useView(db: string | null, name: string | null) {
  const pollMs = usePollMs()
  return useQuery({
    queryKey: ['view', db, name],
    queryFn: () => api.view(db!, name!),
    enabled: !!db && !!name,
    refetchInterval: pollMs,
  })
}

export function useHistory(db: string | null, name: string | null) {
  return useQuery({
    queryKey: ['history', db, name],
    queryFn: () => api.history(db!, name!, 20),
    enabled: !!db && !!name,
  })
}

function useInvalidateAll() {
  const qc = useQueryClient()
  return () => {
    qc.invalidateQueries({ queryKey: ['graph'] })
    qc.invalidateQueries({ queryKey: ['dashboard'] })
    qc.invalidateQueries({ queryKey: ['view'] })
    qc.invalidateQueries({ queryKey: ['history'] })
  }
}

type ViewArg = { db: string; name: string }

export function useViewActions() {
  const invalidate = useInvalidateAll()
  const toast = useStore((s) => s.pushToast)

  const onErr = (e: unknown) => toast('error', e instanceof Error ? e.message : String(e))

  const refresh = useMutation({
    mutationFn: ({ db, name, cascade, wait }: ViewArg & { cascade?: boolean; wait?: boolean }) =>
      api.refresh(db, name, { cascade, wait }),
    onSuccess: (res, vars) => {
      if (vars.cascade) {
        const n = res.total ?? res.refreshed?.length ?? 0
        if (res.errors && res.errors.length) {
          toast('error', `Cascade: ${n} refreshed, ${res.errors.length} failed — ${res.errors[0]}`)
        } else {
          toast('success', `Cascade refreshed ${n} view(s)`)
        }
      } else {
        toast('success', `Refresh triggered for ${vars.db}.${vars.name}`)
      }
      invalidate()
    },
    onError: onErr,
  })

  const stop = useMutation({
    mutationFn: ({ db, name }: ViewArg) => api.stop(db, name),
    onSuccess: (_r, v) => { toast('info', `Stopped ${v.db}.${v.name}`); invalidate() },
    onError: onErr,
  })
  const start = useMutation({
    mutationFn: ({ db, name }: ViewArg) => api.start(db, name),
    onSuccess: (_r, v) => { toast('success', `Started ${v.db}.${v.name}`); invalidate() },
    onError: onErr,
  })
  const cancel = useMutation({
    mutationFn: ({ db, name }: ViewArg) => api.cancel(db, name),
    onSuccess: (_r, v) => { toast('info', `Cancelled refresh of ${v.db}.${v.name}`); invalidate() },
    onError: onErr,
  })

  return { refresh, stop, start, cancel }
}
