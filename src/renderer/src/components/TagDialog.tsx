import { useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { Check } from 'lucide-react'
import { TAG_COLORS, type AccountTag, type TagColor } from '@shared/types'

interface Props {
  open?: boolean
  /** The tag being edited, or null for a new one. */
  tag: AccountTag | null
  /** How many accounts a new tag goes on. */
  count: number
  /** Starting colour for a new tag. */
  nextColor?: TagColor
  onSubmit(name: string, color: TagColor): void
  onClose(): void
  /** Where focus goes on close when the element that opened the dialog is gone. */
  returnFocus?(): void
}

/** Name and colour for a new or existing tag. */
export function TagDialog({ open = true, tag, count, nextColor = 'blue', onSubmit, onClose, returnFocus }: Props) {
  const [name, setName] = useState(tag?.name ?? '')
  const [color, setColor] = useState<TagColor>(tag?.color ?? nextColor)
  const clean = name.trim()
  const unchanged = !!tag && clean === tag.name && color === tag.color
  return (
    <Dialog.Root open={open} onOpenChange={(o) => !o && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="overlay" />
        <Dialog.Content
          className="sheet"
          aria-describedby={undefined}
          onCloseAutoFocus={(e) => {
            if (!returnFocus) return
            e.preventDefault()
            returnFocus()
          }}
        >
          <div className="sheet-head">
            <Dialog.Title>{tag ? 'Edit tag' : 'New tag'}</Dialog.Title>
          </div>
          <form
            onSubmit={(e) => {
              e.preventDefault()
              if (clean && !unchanged) onSubmit(clean, color)
            }}
          >
            <div className="field">
              <label htmlFor="tag-name">Name</label>
              <input id="tag-name" value={name} maxLength={40} autoFocus onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="field">
              <span className="label" id="tag-color-label">
                Colour
              </span>
              <div className="swatches" role="radiogroup" aria-labelledby="tag-color-label">
                {TAG_COLORS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    role="radio"
                    aria-checked={c === color}
                    aria-label={c}
                    className={`swatch tag-${c}`}
                    onClick={() => setColor(c)}
                  >
                    {c === color && <Check size={14} strokeWidth={3} aria-hidden />}
                  </button>
                ))}
              </div>
            </div>
            <div className="dialog-actions">
              <Dialog.Close className="btn" type="button">
                Cancel
              </Dialog.Close>
              <button className="btn btn-primary" type="submit" disabled={!clean || unchanged}>
                {tag ? 'Save' : count > 0 ? `Add to ${count} ${count === 1 ? 'account' : 'accounts'}` : 'Create'}
              </button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
