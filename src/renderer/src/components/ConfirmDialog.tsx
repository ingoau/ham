import { useEffect, useRef, useState } from 'react'

interface Props {
  title: string
  message: string
  confirmLabel: string
  busyLabel: string
  onConfirm(): Promise<void>
  onCancel(): void
}

export function ConfirmDialog({ title, message, confirmLabel, busyLabel, onConfirm, onCancel }: Props) {
  const [busy, setBusy] = useState(false)
  const cancelRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    cancelRef.current?.focus()
  }, [])

  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && !busy && onCancel()}>
      <div className="sheet" role="alertdialog" aria-modal="true" aria-labelledby="confirm-title" aria-describedby="confirm-message">
        <div className="sheet-head">
          <h2 id="confirm-title">{title}</h2>
          <p id="confirm-message" className="lead">
            {message}
          </p>
        </div>
        <div className="dialog-actions">
          <button ref={cancelRef} className="btn" disabled={busy} onClick={onCancel}>
            Cancel
          </button>
          <button
            className="btn btn-primary"
            disabled={busy}
            onClick={async () => {
              setBusy(true)
              try {
                await onConfirm()
              } finally {
                setBusy(false)
              }
            }}
          >
            {busy ? busyLabel : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
