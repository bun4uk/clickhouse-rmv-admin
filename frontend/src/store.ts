import { create } from 'zustand'
import type { UiStatus } from './types'

export interface Toast {
  id: number
  kind: 'success' | 'error' | 'info'
  message: string
}

interface AppStore {
  selected: { database: string; name: string } | null
  select: (database: string, name: string) => void
  clearSelection: () => void

  search: string
  setSearch: (s: string) => void
  dbFilter: string | null
  setDbFilter: (db: string | null) => void
  statusFilter: UiStatus | null
  setStatusFilter: (s: UiStatus | null) => void

  toasts: Toast[]
  pushToast: (kind: Toast['kind'], message: string) => void
  dismissToast: (id: number) => void
}

let toastId = 0

export const useStore = create<AppStore>((set) => ({
  selected: null,
  select: (database, name) => set({ selected: { database, name } }),
  clearSelection: () => set({ selected: null }),

  search: '',
  setSearch: (search) => set({ search }),
  dbFilter: null,
  setDbFilter: (dbFilter) => set({ dbFilter }),
  statusFilter: null,
  setStatusFilter: (statusFilter) => set({ statusFilter }),

  toasts: [],
  pushToast: (kind, message) =>
    set((s) => ({ toasts: [...s.toasts, { id: ++toastId, kind, message }] })),
  dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}))
