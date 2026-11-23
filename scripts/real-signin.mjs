// End-to-end check against the real auth.hackclub.com, driving the app UI.
// Not run in CI: it signs in to a real account and needs the emailed code.
//
//   HAM_TEST_EMAIL=you@example.com node scripts/real-signin.mjs
//
// The script waits for the code in the file named by HAM_CODE_FILE (default:
// ./.screenshots-tmp/code.txt). It edits the phone number, puts it back,
// checks the dashboard lockdown, then signs out. Screenshots land in
// .screenshots-tmp/ (git-ignored, since they show the real account).
import { _electron as electron } from 'playwright-core'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, unlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { execFileSync } from 'node:child_process'

const EMAIL = process.env.HAM_TEST_EMAIL
if (!EMAIL) throw new Error('Set HAM_TEST_EMAIL')
const OUT = resolve('.screenshots-tmp')
mkdirSync(OUT, { recursive: true })
const CODE_FILE = process.env.HAM_CODE_FILE ?? join(OUT, 'code.txt')
if (existsSync(CODE_FILE)) unlinkSync(CODE_FILE)

const dir = mkdtempSync(join(tmpdir(), 'ham-real-'))
const app = await electron.launch({ args: ['.'], env: { ...process.env, HAM_USER_DATA: dir } })
const page = await app.firstWindow()
page.on('pageerror', (e) => console.error('pageerror:', e.message))
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a)

async function shot(name) {
  await page.waitForTimeout(400)
  const file = join(OUT, `${name}.png`)
  const id = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getMediaSourceId())
  execFileSync('screencapture', ['-x', '-o', `-l${id.split(':')[1]}`, file])
  log('screenshot', file)
}

try {
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1120, 740))
  await page.getByRole('button', { name: 'Add account' }).first().click()
  await page.getByLabel('Email').fill(EMAIL)
  await page.getByRole('button', { name: 'Send code' }).click()
  await page.getByLabel('Sign-in code').waitFor({ timeout: 30_000 })
  log('CODE_REQUESTED')

  let code = ''
  for (let i = 0; i < 600 && !code; i++) {
    await new Promise((r) => setTimeout(r, 1000))
    if (existsSync(CODE_FILE)) code = readFileSync(CODE_FILE, 'utf8').trim()
  }
  if (!code) throw new Error('No code arrived')
  await page.getByLabel('Sign-in code').fill(code.replace(/\D/g, ''))
  await page.locator('.account-row').first().waitFor({ timeout: 30_000 })
  log('signed in as', await page.locator('.detail-header h1').textContent())
  await shot('real-profile')

  // Edit the phone number and put it back.
  const phone = page.getByLabel('Phone number')
  const original = await phone.inputValue()
  await phone.fill('+1 (555) 010-0000')
  await page.getByRole('button', { name: 'Save' }).click()
  await page.getByText('Saved to auth.hackclub.com').waitFor({ timeout: 30_000 })
  log('saved test phone; field now', await phone.inputValue())
  await page.getByRole('button', { name: 'Refresh' }).click()
  await page.getByText('Profile is up to date').waitFor({ timeout: 30_000 })
  log('after refresh phone is', await phone.inputValue())
  await phone.fill(original)
  if (original !== '+1 (555) 010-0000') {
    await page.getByRole('button', { name: 'Save' }).click()
    await page.waitForFunction(() => document.querySelector('.form-actions .status') === null, null, { timeout: 30_000 })
  }
  log('restored phone to', JSON.stringify(await phone.inputValue()))

  // Validation from the server path (blank last name is caught client-side first).
  const last = page.getByLabel('Last name')
  const lastName = await last.inputValue()
  await last.fill('')
  log('save disabled with blank last name:', await page.getByRole('button', { name: 'Save' }).isDisabled())
  await last.fill(lastName)

  // Dashboard and lockdown.
  await page.getByRole('tab', { name: 'Hack Club Auth' }).click()
  await page.waitForTimeout(3000)
  await shot('real-dashboard')
  const view = app.windows().find((p) => p.url().startsWith('https://auth.hackclub.com'))
  if (view) {
    log('dashboard url', view.url())
    await view.evaluate(() => {
      const form = document.querySelector('form[action^="/saml/"]')
      if (form) form.requestSubmit ? form.requestSubmit() : form.submit()
      else {
        const f = document.createElement('form')
        f.method = 'post'
        f.action = '/saml/idp_initiated/slack'
        document.body.appendChild(f)
        f.submit()
      }
    })
    await page.getByText('Signing in to other apps is turned off in HAM.').waitFor({ timeout: 15_000 })
    log('SSO blocked; dashboard still at', view.url())
    await shot('real-dashboard-sso-blocked')
    await page.getByRole('button', { name: 'OK' }).click()
    await view.evaluate(() => (window.location.href = 'https://hcb.hackclub.com/'))
    await page.getByText('This link leaves Hack Club Auth').waitFor({ timeout: 15_000 })
    log('external link caught; dashboard still at', view.url())
    await page.getByRole('button', { name: 'Stay here' }).click()
  } else {
    log('could not find the dashboard view page')
  }

  // Sign out.
  await page.getByRole('tab', { name: 'Profile' }).click()
  await page.getByRole('button', { name: 'Sign out and remove' }).click()
  await page.getByRole('button', { name: 'Sign out', exact: true }).click()
  await page.locator('.empty').waitFor({ timeout: 30_000 })
  log('signed out:', await page.locator('.toast').first().textContent())
  log('REAL_E2E_OK')
} catch (err) {
  log('REAL_E2E_FAILED', err)
  await shot('real-failure').catch(() => {})
} finally {
  await app.close()
  rmSync(dir, { recursive: true, force: true })
}
