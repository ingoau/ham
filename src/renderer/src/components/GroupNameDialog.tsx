import { useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'

interface Props {
  open?: boolean
  /** Empty for a new group. */
  initial: string
  /** How many accounts go into a new group. */
  count: number
  onSubmit(name: string): void
  onClose(): void
}

export function GroupNameDialog({ open = true, initial, count, onSubmit, onClose }: Props) {
  const [name, setName] = useState(initial)
  const renaming = initial !== ''
  const clean = name.trim()
  return (
    <Dialog.Root open={open} onOpenChange={(o) => !o && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="overlay" />
        <Dialog.Content className="sheet" aria-describedby={undefined}>
          <div className="sheet-head">
            <Dialog.Title>{renaming ? 'Rename group' : 'New group'}</Dialog.Title>
          </div>
          <form
            onSubmit={(e) => {
              e.preventDefault()
              if (clean) onSubmit(clean)
            }}
          >
            <div className="field">
              <label htmlFor="group-name">Name</label>
              <input id="group-name" value={name} maxLength={60} autoFocus onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="dialog-actions">
              <Dialog.Close className="btn" type="button">
                Cancel
              </Dialog.Close>
              <button className="btn btn-primary" type="submit" disabled={!clean || clean === initial}>
                {renaming ? 'Rename' : count > 0 ? `Create with ${count} ${count === 1 ? 'account' : 'accounts'}` : 'Create'}
              </button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
