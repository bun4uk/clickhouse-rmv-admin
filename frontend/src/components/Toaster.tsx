import { useEffect } from 'react'
import { CheckCircle2, AlertCircle, Info, X } from 'lucide-react'
import { useStore } from '../store'

const ICONS = {
  success: <CheckCircle2 size={16} className="text-emerald-400" />,
  error: <AlertCircle size={16} className="text-red-400" />,
  info: <Info size={16} className="text-sky-400" />,
}

export function Toaster() {
  const toasts = useStore((s) => s.toasts)
  const dismiss = useStore((s) => s.dismissToast)

  return (
    <div className="fixed bottom-4 right-4 z-[60] flex w-80 flex-col gap-2">
      {toasts.map((t) => (
        <ToastCard key={t.id} id={t.id} kind={t.kind} message={t.message} onDismiss={dismiss} />
      ))}
    </div>
  )
}

function ToastCard({
  id,
  kind,
  message,
  onDismiss,
}: {
  id: number
  kind: 'success' | 'error' | 'info'
  message: string
  onDismiss: (id: number) => void
}) {
  useEffect(() => {
    const ms = kind === 'error' ? 8000 : 4000
    const timer = setTimeout(() => onDismiss(id), ms)
    return () => clearTimeout(timer)
  }, [id, kind, onDismiss])

  return (
    <div className="flex items-start gap-2 rounded-lg border border-slate-700 bg-slate-900 p-3 text-sm shadow-xl">
      <div className="mt-0.5">{ICONS[kind]}</div>
      <div className="flex-1 break-words text-slate-200">{message}</div>
      <button onClick={() => onDismiss(id)} className="text-slate-500 hover:text-slate-200">
        <X size={14} />
      </button>
    </div>
  )
}
