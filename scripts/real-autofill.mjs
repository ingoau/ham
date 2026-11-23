// End-to-end check of the linked inbox against real servers: links an IMAP
// inbox through Settings, adds an account, waits for the code to autofill from
// the inbox, checks "Find in inbox", then signs out and unlinks. Not for CI.
//
//   HAM_TEST_EMAIL=alt@example.com HAM_IMAP_HOST=imap.fastmail.com:993 \
//   HAM_IMAP_USER_FILE=/path/user HAM_IMAP_PASS_FILE=/path/pass node scripts/real-autofill.mjs
//
// Credentials are read from files and typed into the app; they're never printed.
import { _electron as electron } from 'playwright-core'
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { captureWindow } from './capture.mjs'

const EMAIL = process.env.HAM_TEST_EMAIL
const HOST = process.env.HAM_IMAP_HOST ?? 'imap.fastmail.com:993'
const USER = readFileSync(process.env.HAM_IMAP_USER_FILE, 'utf8').trim()
const PASS = readFileSync(process.env.HAM_IMAP_PASS_FILE, 'utf8').trim()
if (!EMAIL || !USER || !PASS) throw new Error('Set HAM_TEST_EMAIL, HAM_IMAP_USER_FILE and HAM_IMAP_PASS_FILE')

const OUT = resolve('.screenshots-tmp')
mkdirSync(OUT, { recursive: true })
const dir = mkdtempSync(join(tmpdir(), 'ham-real-'))
const app = await electron.launch({ args: ['.'], env: { ...process.env, HAM_USER_DATA: dir } })
const page = await app.firstWindow()
if (process.env.HAM_DEBUG_INBOX === '1') app.process().stdout.on('data', (d) => process.stdout.write(String(d).replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+/g, '<addr>')))
page.on('pageerror', (e) => console.error('pageerror:', e.message))
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a)
const shot = async (n) => {
  try {
    await captureWindow(app, join(OUT, `${n}.png`))
  } catch {
    // screenshots are optional
  }
}
const row = (text) => page.locator('.account-row', { hasText: text })

try {
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1180, 760))
  await page.getByRole('button', { name: 'Settings' }).click()
  await page.getByRole('radio', { name: 'Other' }).click()
  await page.locator('#imap-host').fill(HOST)
  await page.locator('#imap-email').fill(USER)
  await page.locator('#imap-pass').fill(PASS)
  const t0 = Date.now()
  await page.getByRole('button', { name: 'Link inbox' }).click()
  await Promise.race([
    page.getByRole('button', { name: 'Unlink' }).waitFor({ timeout: 45_000 }),
    page.locator('.settings-section .error-text').waitFor({ timeout: 45_000 })
  ])
  if (await page.locator('.settings-section .error-text').count()) {
    throw new Error(`link failed: ${await page.locator('.settings-section .error-text').textContent()}`)
  }
  await page.locator('.dot-connected').waitFor({ timeout: 45_000 })
  log(`INBOX_LINKED in ${((Date.now() - t0) / 1000).toFixed(1)}s`)
  await shot('real-settings-linked')
  await page.keyboard.press('Escape')

  // Find in inbox should list the test address from past HCA emails.
  await page.getByRole('button', { name: 'Add account', exact: true }).click()
  await page.getByRole('tab', { name: 'Find in inbox' }).click()
  await page.locator('.found-list, .inbox-needed, .settings-section .error-text, p.muted').first().waitFor({ timeout: 90_000 })
  await page.locator('.found-list').waitFor({ timeout: 120_000 })
  const found = await page.locator('.found-email').allTextContents()
  log(`FIND_IN_INBOX ${found.length} addresses; includes test email: ${found.includes(EMAIL.toLowerCase())}`)
  await shot('real-find-in-inbox')

  // Add the account by email; the code should fill itself in.
  await page.getByRole('tab', { name: 'Email' }).click()
  await page.locator('#add-email').fill(EMAIL)
  const t1 = Date.now()
  await page.getByRole('button', { name: 'Add', exact: true }).click()
  await row(EMAIL).waitFor({ timeout: 10_000 })
  log('ADDED, waiting for autofill')
  await page.getByText('From your inbox').waitFor({ timeout: 120_000 }).then(
    () => shot('real-autofill-code'),
    () => {}
  )
  await page.locator('.account-row .name', { hasText: /^(?!.*@)/ }).first().waitFor({ timeout: 120_000 })
  await page.locator('.detail-header .email', { hasText: EMAIL }).waitFor({ timeout: 120_000 })
  log(`AUTOFILL_SIGNED_IN in ${((Date.now() - t1) / 1000).toFixed(1)}s as ${await page.locator('.detail-header h1').textContent()}`)
  log('SLACK_STATUS', await page.locator('.facts .value').nth(2).textContent())
  await shot('real-signed-in')

  // Clean up: sign out, unlink.
  await page.getByRole('button', { name: 'Sign out and remove' }).click()
  await page.getByRole('button', { name: 'Sign out', exact: true }).click()
  await page.locator('.empty').waitFor({ timeout: 30_000 })
  log('SIGNED_OUT')
  await page.getByRole('button', { name: 'Settings' }).click()
  await page.getByRole('button', { name: 'Unlink' }).click()
  await page.getByRole('button', { name: 'Link inbox' }).waitFor({ timeout: 10_000 })
  log('UNLINKED')
  log('REAL_AUTOFILL_OK')
} catch (err) {
  log('REAL_AUTOFILL_FAILED', err.message)
  await shot('real-autofill-failure')
} finally {
  await app.close()
  rmSync(dir, { recursive: true, force: true })
}
