import { useState } from 'react'
import * as AlertDialog from '@radix-ui/react-alert-dialog'
import { Check } from 'lucide-react'

export interface ImportSummary {
  token: string
  added: number
  existing: number
  hasView: boolean
}

interface Props {
  open: boolean
  summary: ImportSummary
  onClose(): void
  onImport(applyView: boolean): Promise<void>
}

/** Confirm an import file: how many accounts are new, and whether to take its view settings too. */
export function ImportDialog({ open, summary, onClose, onImport }: Props) {
  const [applyView, setApplyView] = useState(false)
  const [busy, setBusy] = useState(false)
  const { added, existing, hasView } = summary
  const canImport = added > 0 || applyView
  return (
    <AlertDialog.Root open={open} onOpenChange={(o) => !o && !busy && onClose()}>
      <AlertDialog.Portal>
        <AlertDialog.Overlay className="overlay" />
        <AlertDialog.Content className="sheet" aria-describedby={undefined}>
          <div className="sheet-head">
            <AlertDialog.Title>Import accounts</AlertDialog.Title>
          </div>
          <ul className="signout-list" aria-label="Accounts">
            <li>
              <span>New accounts</span>
              <span>{added}</span>
            </li>
            <li>
              <span>Already in HAM</span>
              <span className="muted">{existing}</span>
            </li>
          </ul>
          {hasView && (
            <button className="setting-check" role="checkbox" aria-checked={applyView} onClick={() => setApplyView(!applyView)}>
              <span className={`checkbox${applyView ? ' on' : ''}`} aria-hidden>
                {applyView && <Check size={12} strokeWidth={3} />}
              </span>
              Apply view settings
            </button>
          )}
          <div className="dialog-actions">
            <AlertDialog.Cancel className="btn" disabled={busy}>
              Cancel
            </AlertDialog.Cancel>
            <AlertDialog.Action
              className="btn btn-primary"
              disabled={busy || !canImport}
              onClick={async (e) => {
                e.preventDefault()
                setBusy(true)
                try {
                  await onImport(applyView)
                } finally {
                  setBusy(false)
                }
              }}
            >
              {added > 0 ? `Add ${added} ${added === 1 ? 'account' : 'accounts'}` : 'Import'}
            </AlertDialog.Action>
          </div>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  )
}
