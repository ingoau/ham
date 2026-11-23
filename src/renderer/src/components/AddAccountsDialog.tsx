import { useEffect, useMemo, useRef, useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { Check, Loader2, X } from 'lucide-react'
import type { Account, FoundAddress } from '@shared/types'
import { isEmail, parseEmailList } from '../emails'

export type AddMode = 'one' | 'paste' | 'inbox'

const TABS: [AddMode, string][] = [
  ['one', 'Email'],
  ['paste', 'Paste a list'],
  ['inbox', 'Find in inbox']
]


interface Props {
  mode: AddMode
  accounts: Account[]
  inboxOn: boolean
  onMode(mode: AddMode): void
  onClose(): void
  onAdd(emails: string[]): void
  onOpenSettings(): void
}

export function AddAccountsDialog({ mode, accounts, inboxOn, onMode, onClose, onAdd, onOpenSettings }: Props) {
  const [email, setEmail] = useState('')
  const [paste, setPaste] = useState('')
  const [found, setFound] = useState<FoundAddress[] | null>(null)
  const [findError, setFindError] = useState<string | null>(null)
  const [foundSel, setFoundSel] = useState<Set<string> | null>(null)
  const emailRef = useRef<HTMLInputElement>(null)
  const have = useMemo(() => new Set(accounts.map((a) => a.email.toLowerCase())), [accounts])

  useEffect(() => {
    if (mode !== 'inbox' || !inboxOn || found !== null) return
    let live = true
    void window.ham.inbox.findAddresses().then((r) => {
      if (!live) return
      if (r.ok) setFound(r.addresses)
      else setFindError(r.message)
    })
    return () => {
      live = false
    }
  }, [mode, inboxOn, found])

  const pasted = parseEmailList(paste)
  const pastedNew = pasted.filter((e, i) => !have.has(e) && pasted.indexOf(e) === i)
  // New addresses; ones HCA says have no account start unticked.
  const foundOpen = (found ?? []).filter((f) => !have.has(f.email)).map((f) => f.email)
  const foundNew = (found ?? []).filter((f) => !have.has(f.email) && f.hasAccount !== false).map((f) => f.email)
  const selected = foundSel ?? new Set(foundNew)
  const foundPicked = foundOpen.filter((e) => selected.has(e))
  const one = email.trim().toLowerCase()
  const toAdd = mode === 'one' ? (isEmail(one) ? [one] : []) : mode === 'paste' ? pastedNew : inboxOn ? foundPicked : []
  const button =
    mode === 'one' ? 'Add' : toAdd.length ? `Add ${toAdd.length} ${toAdd.length === 1 ? 'account' : 'accounts'}` : 'Add accounts'

  return (
    <Dialog.Root open onOpenChange={(o) => !o && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="overlay" />
        <Dialog.Content
          className="sheet sheet-wide"
          aria-describedby={undefined}
          onOpenAutoFocus={(e) => {
            if (mode === 'one') {
              e.preventDefault()
              emailRef.current?.focus()
            }
          }}
        >
          <Dialog.Close className="icon-btn sheet-close" aria-label="Close">
            <X size={18} aria-hidden />
          </Dialog.Close>
          <div className="sheet-head">
            <Dialog.Title>Add accounts</Dialog.Title>
          </div>
          <div className="segmented" role="tablist" aria-label="How to add">
            {TABS.map(([id, name]) => (
              <button key={id} role="tab" aria-selected={mode === id} className="seg" onClick={() => onMode(id)}>
                {name}
              </button>
            ))}
          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault()
              if (toAdd.length) onAdd(toAdd)
            }}
          >
            {mode === 'one' && (
              <div className="field">
                <label htmlFor="add-email">Email</label>
                <input ref={emailRef} id="add-email" type="email" autoComplete="email" placeholder="you@example.com" value={email} onChange={(e) => setEmail(e.target.value)} />
              </div>
            )}

            {mode === 'paste' && (
              <div className="field">
                <label htmlFor="add-paste">Emails, one per line or comma-separated</label>
                <textarea id="add-paste" rows={6} value={paste} onChange={(e) => setPaste(e.target.value)} autoFocus />
                <span className="hint">
                  {pasted.length ? `${pastedNew.length} new · ${pasted.length - pastedNew.length} already in HAM or repeated` : 'Nothing pasted yet'}
                </span>
              </div>
            )}

            {mode === 'inbox' &&
              (!inboxOn ? (
                <div className="inbox-needed">
                  <p className="muted">Link an inbox in Settings first.</p>
                  <button type="button" className="btn" onClick={onOpenSettings}>
                    Open Settings
                  </button>
                </div>
              ) : findError ? (
                <p className="error-text">{findError}</p>
              ) : found === null ? (
                <div className="loading-list" role="status" aria-live="polite">
                  <span className="loading-head">
                    <Loader2 size={15} className="spin" aria-hidden />
                    Searching your inbox for Hack Club emails…
                  </span>
                  <ul className="skeleton-list" aria-hidden>
                    {[68, 52, 74, 46, 60].map((w, i) => (
                      <li key={i} className="skeleton-row">
                        <span className="skeleton box" />
                        <span className="skeleton" style={{ width: `${w}%`, animationDelay: `${i * 0.12}s` }} />
                      </li>
                    ))}
                  </ul>
                </div>
              ) : found.length === 0 ? (
                <p className="muted">No Hack Club emails found.</p>
              ) : (
                <div className="found">
                  <div className="found-head">
                    <span className="muted small">
                      {found.length} addresses · {foundNew.length} new
                    </span>
                    <button
                      type="button"
                      className="btn-link strong inline"
                      onClick={() => setFoundSel(foundPicked.length > 0 ? new Set() : new Set(foundNew))}
                    >
                      {foundPicked.length > 0 ? 'Select none' : 'Select all'}
                    </button>
                  </div>
                  <ul className="found-list">
                    {found.map(({ email: e, sources, hasAccount }) => {
                      const already = have.has(e)
                      const on = !already && selected.has(e)
                      const note = already ? 'Already in HAM' : hasAccount === false ? 'No Hack Club account' : null
                      return (
                        <li key={e}>
                          <button
                            type="button"
                            role="checkbox"
                            aria-checked={on}
                            disabled={already}
                            className={`found-item${note ? ' dim' : ''}`}
                            onClick={() => {
                              const next = new Set(selected)
                              if (next.has(e)) next.delete(e)
                              else next.add(e)
                              setFoundSel(next)
                            }}
                          >
                            <span className={`checkbox${on ? ' on' : ''}`} aria-hidden>
                              {on && <Check size={13} strokeWidth={3} />}
                            </span>
                            <span className="found-text">
                              <span className="found-email">{e}</span>
                              <span className="found-source">{sources.map((s) => (s === 'hca' ? 'Hack Club Auth' : 'Slack')).join(' · ')}</span>
                            </span>
                            {note && <span className="muted small">{note}</span>}
                          </button>
                        </li>
                      )
                    })}
                  </ul>
                </div>
              ))}

            <div className="form-actions">
              <button type="submit" className="btn btn-primary" disabled={toAdd.length === 0}>
                {button}
              </button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
