import * as AlertDialog from '@radix-ui/react-alert-dialog'

interface Props {
  open?: boolean
  onDiscard(): void
  onCancel(): void
}

/** Asked before leaving a profile with unsaved edits. */
export function DiscardDialog({ open = true, onDiscard, onCancel }: Props) {
  return (
    <AlertDialog.Root open={open} onOpenChange={(o) => !o && onCancel()}>
      <AlertDialog.Portal>
        <AlertDialog.Overlay className="overlay" />
        <AlertDialog.Content className="sheet" aria-describedby={undefined}>
          <div className="sheet-head">
            <AlertDialog.Title>Discard unsaved changes?</AlertDialog.Title>
          </div>
          <div className="dialog-actions">
            <AlertDialog.Cancel className="btn">Keep editing</AlertDialog.Cancel>
            <AlertDialog.Action className="btn btn-primary" onClick={onDiscard}>
              Discard
            </AlertDialog.Action>
          </div>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  )
}
