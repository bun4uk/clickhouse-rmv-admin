import { useState } from 'react'
import { AlertTriangle } from 'lucide-react'
import { Dialog, DialogContent, DialogTitle } from './ui/dialog'
import { Button } from './ui/button'
import type { ViewDetails } from '../types'

export function RefreshDialog({
  view,
  open,
  onOpenChange,
  onConfirm,
}: {
  view: ViewDetails
  open: boolean
  onOpenChange: (o: boolean) => void
  onConfirm: (opts: { cascade: boolean; wait: boolean }) => void
}) {
  const [cascade, setCascade] = useState(false)
  const [wait, setWait] = useState(false)
  const isAppend = view.mode === 'APPEND'
  const hasConsumers = view.consumers.length > 0

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogTitle>
          Refresh {view.database}.{view.name}
        </DialogTitle>

        {isAppend ? (
          <div className="mt-3 flex gap-3 rounded-lg border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-200">
            <AlertTriangle size={20} className="mt-0.5 shrink-0 text-red-400" />
            <div>
              This view runs in <b>APPEND</b> mode. A manual refresh <b>adds</b> a new set of rows
              rather than replacing existing data — this can <b>duplicate</b> data. Proceed only if
              you intend to append another batch.
            </div>
          </div>
        ) : (
          <p className="mt-3 text-sm text-slate-400">
            REPLACE mode: the refresh atomically replaces the view's contents. Safe to re-run.
          </p>
        )}

        <div className="mt-4 space-y-2">
          <label className="flex items-start gap-2 text-sm text-slate-300">
            <input
              type="checkbox"
              checked={cascade}
              onChange={(e) => setCascade(e.target.checked)}
              disabled={!hasConsumers}
              className="mt-1"
            />
            <span>
              Cascade — also refresh downstream consumers in dependency order
              {!hasConsumers && <span className="text-slate-500"> (no consumers)</span>}
              <span className="block text-[11px] text-slate-500">
                Done by this tool (ClickHouse does not cascade); each step waits for the previous.
              </span>
            </span>
          </label>
          <label className="flex items-start gap-2 text-sm text-slate-300">
            <input
              type="checkbox"
              checked={wait || cascade}
              disabled={cascade}
              onChange={(e) => setWait(e.target.checked)}
              className="mt-1"
            />
            <span>
              Wait for completion (SYSTEM WAIT VIEW) — report the actual result
              <span className="block text-[11px] text-slate-500">
                Blocks until the refresh finishes; otherwise it is fire-and-forget.
              </span>
            </span>
          </label>
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant={isAppend ? 'danger' : 'primary'}
            onClick={() => {
              onConfirm({ cascade, wait: wait || cascade })
              onOpenChange(false)
            }}
          >
            {isAppend ? 'Append anyway' : 'Refresh now'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
