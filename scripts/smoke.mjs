// UI smoke test in demo mode (no network). Runs in CI under xvfb on Linux.
//   node scripts/smoke.mjs                 # against the dev build in ./out
//   node scripts/smoke.mjs path/to/HAM     # against a packaged executable
import { _electron as electron } from 'playwright-core'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const executablePath = process.argv[2]
const dir = mkdtempSync(join(tmpdir(), 'ham-smoke-'))
const app = await electron.launch({
  ...(executablePath ? { executablePath } : { args: ['.'] }),
  env: { ...process.env, HAM_MOCK: '1', HAM_MOCK_SEED: '1', HAM_USER_DATA: dir }
})
const page = await app.firstWindow()
const errors = []
page.on('pageerror', (e) => errors.push(e.message))
const step = (name) => console.log(`✓ ${name}`)
const row = (text) => page.locator('.account-row', { hasText: text })
const names = () => page.locator('.account-row .name').allTextContents()

try {
  await page.locator('.account-row').first().waitFor({ timeout: 20_000 })
  if ((await page.locator('.account-row').count()) !== 3) throw new Error('expected 3 seeded accounts')
  step('lists seeded accounts')

  await page.locator('.search-button').click()
  await page.locator('.cmdk-input').fill('sam')
  await page.keyboard.press('Enter')
  await page.locator('.detail-header h1', { hasText: 'Sam Rivera' }).waitFor({ timeout: 5_000 })
  step('command palette finds and opens an account')

  // Add one account by email: it appears at once and signs in inline.
  await page.locator('.search-button').click()
  await page.locator('.cmdk-input').fill('add accounts')
  await page.keyboard.press('Enter')
  await page.locator('#add-email').fill('orpheus.dino@example.com')
  await page.getByRole('button', { name: 'Add', exact: true }).click()
  await row('orpheus.dino@example.com').waitFor({ timeout: 5_000 })
  await page.locator('#pending-code').waitFor({ timeout: 10_000 })
  await page.locator('#pending-code').fill('000000')
  await page.getByText('Invalid or expired code').waitFor({ timeout: 10_000 })
  await page.locator('#pending-code').fill('123456')
  await row('Orpheus Dino').waitFor({ timeout: 10_000 })
  step('adds an account inline, rejecting a wrong code first')

  // Link the (mock) inbox, then paste a list: codes fill in by themselves.
  await page.getByRole('button', { name: 'Settings' }).click()
  await page.locator('#imap-email').fill('me@example.com')
  await page.locator('#imap-pass').fill('app-password')
  await page.getByRole('button', { name: 'Link inbox' }).click()
  await page.getByRole('button', { name: 'Unlink' }).waitFor({ timeout: 10_000 })
  await page.keyboard.press('Escape')
  step('links an inbox')

  await page.getByRole('button', { name: 'Add account' }).click()
  await page.getByRole('tab', { name: 'Paste a list' }).click()
  await page.locator('#add-paste').fill('one.alt@example.com, 2fa.two@example.com; new.three@example.com\nfiona@example.com')
  await page.getByText('3 new · 1 already in HAM or repeated').waitFor()
  await page.getByRole('button', { name: 'Add 3 accounts' }).click()
  await row('One Alt').waitFor({ timeout: 15_000 })
  await row('new.three@example.com').getByText('Fix').waitFor({ timeout: 10_000 })
  await row('2fa.two@example.com').getByText('2FA').waitFor({ timeout: 15_000 })
  step('pasted accounts sign in with autofilled codes; unknown email shows Fix')

  await row('2fa.two@example.com').locator('.row-main').click()
  await page.locator('#pending-2fa').fill('654321')
  await row('Two Member').waitFor({ timeout: 10_000 })
  step('finishes a 2FA sign-in with the authenticator code')

  await row('new.three@example.com').locator('.row-main').click()
  await page.getByRole('button', { name: 'Remove' }).click()
  await row('new.three@example.com').waitFor({ state: 'detached', timeout: 5_000 })
  step('removes a failed account')

  // Select a range and bulk edit first names, then undo.
  await row('Fiona Hackworth').first().locator('.row-check').click()
  await row('Orpheus Dino').locator('.row-check').click({ modifiers: ['Shift'] })
  const picked = await page.locator('.account-row.checked').count()
  if (picked < 2) throw new Error(`range select picked ${picked}`)
  await page.getByRole('button', { name: 'Bulk edit' }).click()
  await page.locator('#bulk-tpl').click()
  await page.keyboard.press('ControlOrMeta+a')
  await page.keyboard.type('{{ account.first | upper }}')
  await page.getByRole('button', { name: /^Apply to \d+ accounts?$/ }).click()
  await page.getByText(/^Updated \d+ accounts?$/).waitFor({ timeout: 15_000 })
  if (!(await names()).some((n) => n.startsWith('FIONA'))) throw new Error('bulk edit did not apply')
  if ((await page.locator('.account-row.checked').count()) !== picked) throw new Error('selection was not kept')
  await page.getByRole('button', { name: 'Undo' }).click()
  await page.getByText(/^Changes undone/).waitFor({ timeout: 15_000 })
  if ((await names()).some((n) => n.startsWith('FIONA'))) throw new Error('undo did not restore')
  await page.getByRole('button', { name: 'Clear selection' }).click()
  step('bulk edits a range of accounts, keeps the selection and undoes')

  // View options: group by status, template first line.
  await page.getByRole('button', { name: 'View options' }).click()
  await page.locator('#view-group').selectOption('status')
  await page.locator('#view-line1').selectOption('email')
  await page.keyboard.press('Escape')
  await page.locator('.group-header', { hasText: 'Signed out' }).waitFor()
  if (!(await names()).includes('fiona@example.com')) throw new Error('first line did not switch to email')
  step('groups by status and changes the first line')

  await page.getByRole('button', { name: 'Settings' }).click()
  await page.getByRole('radio', { name: 'Dark' }).click()
  const dark = await app.evaluate(({ nativeTheme }) => nativeTheme.themeSource)
  if (dark !== 'dark') throw new Error('theme did not change')
  await page.getByRole('radio', { name: 'System' }).click()
  await page.keyboard.press('Escape')
  step('switches the theme')

  await row('orpheus.dino@example.com').locator('.row-main').click()
  await page.getByRole('tab', { name: 'Hack Club Auth' }).click()
  await page.locator('.dash-address').waitFor()
  await page.getByRole('tab', { name: 'Profile' }).click()
  step('opens the dashboard tab')

  await page.getByRole('button', { name: 'Sign out and remove' }).click()
  await page.getByRole('button', { name: 'Sign out', exact: true }).click()
  await page.getByText('Signed out of orpheus.dino@example.com').waitFor({ timeout: 10_000 })
  step('signs out and removes an account')

  if (errors.length) throw new Error(`page errors: ${errors.join('; ')}`)
  console.log('SMOKE OK')
} catch (err) {
  console.error('SMOKE FAILED:', err)
  process.exitCode = 1
} finally {
  await app.close()
  rmSync(dir, { recursive: true, force: true })
}
