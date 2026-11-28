import { useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'

interface Props {
  open?: boolean
  /** Empty for a new group. */
  initial: string
  /** How many accounts go into a new group. */
  count: number
  /** Overrides for other names (an account's local name). */
  title?: string
  placeholder?: string
  submitLabel?: string
  /** Allow saving an empty name (clears it). */
  allowEmpty?: boolean
  onSubmit(name: string): void
  onClose(): void
}

/** A one-field name dialog: new group, rename group, or an account's local name. */
export function GroupNameDialog({ open = true, initial, count, title, placeholder, submitLabel, allowEmpty, onSubmit, onClose }: Props) {
  const [name, setName] = useState(initial)
  const renaming = initial !== ''
  const clean = name.replace(/\s+/g, ' ').trim()
  const canSubmit = (allowEmpty || clean !== '') && clean !== initial
  return (
    <Dialog.Root open={open} onOpenChange={(o) => !o && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="overlay" />
        <Dialog.Content className="sheet" aria-describedby={undefined}>
          <div className="sheet-head">
            <Dialog.Title>{title ?? (renaming ? 'Rename group' : 'New group')}</Dialog.Title>
          </div>
          <form
            onSubmit={(e) => {
              e.preventDefault()
              if (canSubmit) onSubmit(clean)
            }}
          >
            <div className="field">
              <label htmlFor="name-dialog-input">Name</label>
              <input
                id="name-dialog-input"
                value={name}
                maxLength={60}
                placeholder={placeholder}
                autoFocus
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            <div className="dialog-actions">
              <Dialog.Close className="btn" type="button">
                Cancel
              </Dialog.Close>
              <button className="btn btn-primary" type="submit" disabled={!canSubmit}>
                {submitLabel ?? (renaming ? 'Rename' : count > 0 ? `Create with ${count} ${count === 1 ? 'account' : 'accounts'}` : 'Create')}
              </button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
