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

try {
  await page.locator('.account-row').first().waitFor({ timeout: 20_000 })
  const rows = await page.locator('.account-row').count()
  if (rows !== 3) throw new Error(`expected 3 seeded accounts, saw ${rows}`)
  step('lists seeded accounts')

  await page.locator('.search-button').click()
  await page.locator('.cmdk-input').fill('sam')
  await page.keyboard.press('Enter')
  await page.locator('.detail-header h1', { hasText: 'Sam Rivera' }).waitFor({ timeout: 5_000 })
  step('command palette finds and opens an account')
  await page.locator('.search-button').click()
  await page.locator('.cmdk-input').fill('add account')
  await page.keyboard.press('Enter')
  await page.getByLabel('Email').waitFor({ timeout: 5_000 })
  await page.keyboard.press('Escape')
  step('command palette runs an action')

  await page.locator('.account-row').first().click()
  await page.getByLabel('Phone number').fill('+1 (555) 000-1111')
  await page.getByRole('button', { name: 'Save' }).click()
  await page.getByText('Saved to auth.hackclub.com').waitFor({ timeout: 10_000 })
  step('saves a profile')

  await page.getByRole('button', { name: 'Add account' }).first().click()
  await page.getByLabel('Email').fill('2fa.orpheus@example.com')
  await page.getByRole('button', { name: 'Send code' }).click()
  await page.getByLabel('Sign-in code').fill('000000')
  await page.getByText('Invalid or expired code').waitFor({ timeout: 10_000 })
  step('rejects a wrong code')
  await page.getByLabel('Sign-in code').fill('123456')
  await page.getByLabel('Authenticator code').waitFor({ timeout: 10_000 })
  await page.getByLabel('Authenticator code').fill('654321')
  await page.getByText('Account added').waitFor({ timeout: 10_000 })
  if ((await page.locator('.account-row').count()) !== 4) throw new Error('new account missing')
  step('adds an account through email and authenticator codes')

  await page.getByRole('tab', { name: 'Hack Club Auth' }).click()
  await page.locator('.dash-address').waitFor()
  step('opens the dashboard tab')
  await page.getByRole('tab', { name: 'Profile' }).click()

  await page.getByRole('button', { name: 'Sign out and remove' }).click()
  await page.getByRole('button', { name: 'Sign out', exact: true }).click()
  await page.getByText('Signed out of 2fa.orpheus@example.com').waitFor({ timeout: 10_000 })
  if ((await page.locator('.account-row').count()) !== 3) throw new Error('account not removed')
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
