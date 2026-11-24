// Drives HAM in demo mode (HAM_MOCK=1) with Playwright and saves screenshots
// of the main UI states to docs/screenshots. Nothing is sent to
// auth.hackclub.com. Run with `pnpm screenshots` (macOS gives the best
// result, since it captures the real window including the embedded view).
import { _electron as electron } from 'playwright-core'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { captureWindow } from './capture.mjs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const OUT = resolve('docs/screenshots')
mkdirSync(OUT, { recursive: true })

async function shot(app, name) {
  await new Promise((r) => setTimeout(r, 450))
  console.log('saved', await captureWindow(app, join(OUT, `${name}.png`)))
}

async function launch({ seed }) {
  const dir = mkdtempSync(join(tmpdir(), 'ham-shots-'))
  const app = await electron.launch({
    args: ['.'],
    env: { ...process.env, HAM_MOCK: '1', HAM_MOCK_SEED: seed ? '1' : '0', HAM_USER_DATA: dir }
  })
  const page = await app.firstWindow()
  page.on('pageerror', (e) => console.error('pageerror:', e.message))
  await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0]
    win.setSize(1120, 740)
    win.center()
    win.focus()
  })
  await page.waitForLoadState('domcontentloaded')
  return { app, page, dir }
}

// Playwright pins pages to a light colour scheme, so set it on every page it
// can see (the app window and the embedded dashboard) as well as natively.
const schemes = new WeakMap()
async function theme(app, source) {
  await app.evaluate(({ nativeTheme }, s) => (nativeTheme.themeSource = s), source)
  if (!schemes.has(app)) app.on('window', (p) => void p.emulateMedia({ colorScheme: schemes.get(app) }).catch(() => {}))
  schemes.set(app, source)
  for (const p of app.windows()) await p.emulateMedia({ colorScheme: source }).catch(() => {})
}

// --- empty state and sign-in ------------------------------------------------
{
  const { app, page, dir } = await launch({ seed: false })
  await theme(app, 'light')
  await page.waitForSelector('.empty')
  await shot(app, 'empty')

  await page.getByRole('button', { name: 'Add accounts' }).first().click()
  await page.locator('#add-email').fill('orpheus@example.com')
  await shot(app, 'add-account')

  await page.getByRole('button', { name: 'Add', exact: true }).click()
  await page.locator('#pending-code').waitFor({ timeout: 10_000 })
  await page.locator('#pending-code').fill('12345')
  await shot(app, 'sign-in-code')
  await app.close()
  rmSync(dir, { recursive: true, force: true })
}

// --- accounts ---------------------------------------------------------------
{
  const { app, page, dir } = await launch({ seed: true })
  await theme(app, 'light')
  await page.waitForSelector('.account-row')
  await page.locator('.account-row').first().click()
  await shot(app, 'profile')

  await page.getByLabel('Last name').fill('Hackworth-Lee')
  await page.getByLabel('Phone number').fill('+1 (555) 201-9999')
  await shot(app, 'profile-editing')
  await page.getByRole('form', { name: 'Profile', exact: true }).getByRole('button', { name: 'Save' }).click()
  await page.getByText('Saved to auth.hackclub.com').waitFor()
  await shot(app, 'profile-saved')

  // The Slack profile, with Hack Club Slack's own fields (demo: a few of them).
  await page.locator('[data-sonner-toast]').first().waitFor({ state: 'detached', timeout: 10_000 }).catch(() => {})
  await page.locator('.account-row', { hasText: 'fiona@example.com' }).click()
  await page.getByRole('button', { name: 'Refresh' }).click()
  await page.getByText('Profile is up to date').waitFor()
  await page.locator('[data-sonner-toast]').first().waitFor({ state: 'detached', timeout: 10_000 }).catch(() => {})
  await page.locator('#slack-heading').evaluate((el) => el.scrollIntoView({ block: 'start' }))
  await page.getByLabel('Pronouns').fill('she/they')
  await page.getByLabel('Status emoji').fill(':sparkles:')
  await page.getByLabel('Status text').fill('Running a hackathon')
  await page.evaluate(() => document.activeElement?.blur())
  await shot(app, 'slack-profile')
  await page.locator('form[aria-labelledby="slack-heading"]').getByRole('button', { name: 'Revert' }).click()
  await page.locator('.content-scroll').evaluate((el) => el.scrollTo(0, 0))

  await page.locator('.account-row', { hasText: 'Sam Rivera' }).click()
  await shot(app, 'signed-out')

  // Local names: set two; the list's default first line (best name) shows them.
  await page.locator('[data-sonner-toast]').first().waitFor({ state: 'detached', timeout: 10_000 }).catch(() => {})
  await page.locator('.account-row', { hasText: 'fiona.leads@example.org' }).click()
  await page.locator('#local-name').fill('Club leads')
  await page.keyboard.press('Enter')
  await page.locator('.account-row', { hasText: 'fiona@example.com' }).click()
  await page.locator('#local-name').fill('Personal')
  await page.keyboard.press('Enter')
  await page.locator('#local-name').blur()
  await page.locator('#local-name').scrollIntoViewIfNeeded()
  await shot(app, 'local-name')
  await page.getByRole('button', { name: 'View options' }).click()
  await page.locator('#view-line2').selectOption('hca')
  await page.keyboard.press('Escape')
  await page.locator('.content-scroll').evaluate((el) => el.scrollTo(0, 0))
  await page.evaluate(() => document.activeElement?.blur())
  await shot(app, 'local-name-list')
  await page.getByRole('button', { name: 'View options' }).click()
  await page.locator('#view-line2').selectOption('email')
  await page.keyboard.press('Escape')
  await page.locator('.content-scroll').evaluate((el) => el.scrollTo(0, 0))

  await page.locator('.account-row').first().click()
  await page.getByRole('tab', { name: 'Hack Club Auth' }).click()
  await new Promise((r) => setTimeout(r, 900))
  await shot(app, 'dashboard')

  await page.getByRole('tab', { name: 'Profile' }).click()
  await page.getByRole('button', { name: 'Sign out and remove' }).click()
  await shot(app, 'sign-out-confirm')
  await page.getByRole('button', { name: 'Cancel' }).click()

  await page.locator('.search-button').click()
  await page.locator('.cmdk-input').fill('fiona')
  await shot(app, 'command-palette')
  await page.keyboard.press('Escape')

  await theme(app, 'dark')
  await page.locator('.account-row').first().click()
  await shot(app, 'profile-dark')
  await page.getByRole('tab', { name: 'Hack Club Auth' }).click()
  await new Promise((r) => setTimeout(r, 900))
  await shot(app, 'dashboard-dark')
  await app.close()
  rmSync(dir, { recursive: true, force: true })
}
