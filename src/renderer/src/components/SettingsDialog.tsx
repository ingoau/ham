import { useState, type FormEvent } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { X } from 'lucide-react'
import { toast } from 'sonner'
import type { AppState, Theme } from '@shared/types'

const THEMES: [Theme, string][] = [
  ['system', 'System'],
  ['light', 'Light'],
  ['dark', 'Dark']
]

const PROVIDERS = [
  { id: 'gmail', name: 'Gmail', host: 'imap.gmail.com:993', note: 'Needs 2-Step Verification and an app password.' },
  { id: 'icloud', name: 'iCloud', host: 'imap.mail.me.com:993', note: 'Make an app-specific password at account.apple.com.' },
  { id: 'fastmail', name: 'Fastmail', host: 'imap.fastmail.com:993', note: 'Make an app password in Fastmail Settings › Privacy & Security.' },
  { id: 'other', name: 'Other', host: '', note: 'Any IMAP server over TLS. Outlook.com isn’t supported yet (it needs OAuth).' }
]

export function SettingsDialog({ open = true, app, onClose }: { open?: boolean; app: AppState; onClose(): void }) {
  const [provider, setProvider] = useState<string | null>(PROVIDERS[0].id)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [host, setHost] = useState(PROVIDERS[0].host)
  const [linking, setLinking] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [checking, setChecking] = useState(false)
  const inbox = app.inbox
  const linked = inbox.state !== 'off'
  const prov = PROVIDERS.find((p) => p.id === provider)

  const link = async (e: FormEvent) => {
    e.preventDefault()
    setLinking(true)
    setError(null)
    try {
      const r = await window.ham.inbox.link({ email, password, host })
      if (r.ok) {
        setPassword('')
        toast.success('Inbox linked')
      } else setError(r.message)
    } finally {
      setLinking(false)
    }
  }

  const checkUpdates = async () => {
    setChecking(true)
    try {
      const r = await window.ham.settings.checkForUpdates()
      if (r.status === 'available') toast(`HAM ${r.update.version} is out`, { action: { label: 'Download', onClick: () => void window.ham.openExternal(r.update.url) } })
      else if (r.status === 'current') toast.success('HAM is up to date')
      else toast.error('Couldn’t check for updates')
    } finally {
      setChecking(false)
    }
  }

  const canLink = !linking && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim()) && password.length > 0 && host.trim().length > 0

  return (
    <Dialog.Root open={open} onOpenChange={(o) => !o && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="overlay" />
        <Dialog.Content className="sheet sheet-wide" aria-describedby={undefined}>
          <Dialog.Close className="icon-btn sheet-close" aria-label="Close">
            <X size={18} aria-hidden />
          </Dialog.Close>
          <div className="sheet-head">
            <Dialog.Title>Settings</Dialog.Title>
          </div>

          <section className="settings-section" aria-labelledby="set-appearance">
            <h3 id="set-appearance">Appearance</h3>
            <div className="segmented" role="radiogroup" aria-labelledby="set-appearance">
              {THEMES.map(([id, name]) => (
                <button key={id} role="radio" aria-checked={app.theme === id} className="seg" onClick={() => void window.ham.settings.setTheme(id)}>
                  {name}
                </button>
              ))}
            </div>
          </section>

          <section className="settings-section" aria-labelledby="set-inbox">
            <h3 id="set-inbox">Linked inbox</h3>
            {linked ? (
              <div className="linked-inbox">
                <span className={`dot dot-${inbox.state}`} aria-hidden />
                <span className="linked-text">
                  <strong>{inbox.email}</strong>
                  <span className="muted small">
                    {inbox.state === 'connected' ? inbox.host : inbox.state === 'connecting' ? 'Connecting…' : inbox.error}
                  </span>
                </span>
                <button className="btn" onClick={() => void window.ham.inbox.unlink().then(() => toast('Inbox unlinked'))}>
                  Unlink
                </button>
              </div>
            ) : (
              <form className="inbox-form" onSubmit={link}>
                <div className="providers" role="radiogroup" aria-label="Provider">
                  {PROVIDERS.map((p) => (
                    <button
                      type="button"
                      key={p.id}
                      role="radio"
                      aria-checked={provider === p.id}
                      className="provider"
                      onClick={() => {
                        setProvider(p.id)
                        setHost(p.host)
                      }}
                    >
                      {p.name}
                    </button>
                  ))}
                </div>
                {prov && <p className="muted small">{prov.note}</p>}
                <div className="field">
                  <label htmlFor="imap-email">Email address</label>
                  <input id="imap-email" type="email" autoComplete="off" value={email} onChange={(e) => setEmail(e.target.value)} />
                </div>
                <div className="field">
                  <label htmlFor="imap-pass">App password</label>
                  <input id="imap-pass" type="password" autoComplete="off" value={password} onChange={(e) => setPassword(e.target.value)} />
                </div>
                <div className="field">
                  <label htmlFor="imap-host">IMAP server</label>
                  <input id="imap-host" value={host} placeholder="imap.example.com:993" onChange={(e) => setHost(e.target.value)} />
                </div>
                {error && <p className="error-text" role="alert">{error}</p>}
                <div className="form-actions">
                  <button type="submit" className="btn btn-primary" disabled={!canLink}>
                    {linking ? 'Connecting…' : 'Link inbox'}
                  </button>
                </div>
              </form>
            )}
          </section>

          <section className="settings-section" aria-labelledby="set-about">
            <h3 id="set-about">About</h3>
            <div className="about-row">
              <span>HAM {app.info.version}</span>
              <button className="btn" disabled={checking} onClick={() => void checkUpdates()}>
                {checking ? 'Checking…' : 'Check for updates'}
              </button>
            </div>
          </section>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
