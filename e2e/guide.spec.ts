import { expect, test } from '@playwright/test'
import { USER_A, wiremockUrl } from './env'
import { signIn } from './helpers'

// A new user follows Getting started using only the guide's own links: New mock → Test → the request log, and the
// Getting started checklist on Mocks ticks itself along the way. Everything it creates is deleted afterwards.

const AUTH = { Authorization: `Basic ${Buffer.from(`${USER_A.username}:${USER_A.password}`).toString('base64')}` }
const MOCK_PATH = '/e2e-guide/posts/42'

type Stored = { id: string; request: { urlPath?: string }; metadata: { wiremockUi: { version: number } } }

test.afterAll(async ({ request }) => {
  const mocks = (await (await request.get('/api/mocks', { headers: AUTH })).json()) as Stored[]
  for (const m of mocks.filter((m) => m.request.urlPath === MOCK_PATH)) {
    await request.delete(`/api/mocks/${m.id}?version=${m.metadata.wiremockUi.version}`, { headers: AUTH })
  }
})

test('Getting started, end to end, from the guide\'s links only', async ({ page }) => {
  await signIn(page, USER_A)
  // ? opens the guide from anywhere.
  await page.goto('/mocks')
  await page.locator('body').press('?')
  await expect(page).toHaveURL(/\/guide$/)
  const start = page.locator('section#getting-started')

  // 2. Create a mock with the URL form.
  await start.getByRole('link', { name: 'New mock →' }).click()
  await expect(page).toHaveURL(/\/mocks\/new$/)
  await page.getByRole('textbox', { name: 'URL' }).fill(MOCK_PATH)
  await page.getByRole('button', { name: 'Save mock' }).click()
  await expect(page.getByText('Mock saved')).toBeVisible()
  await expect.poll(async () => (await fetch(`${wiremockUrl()}${MOCK_PATH}`)).status).toBe(200)

  // 3. Try it: Test → Send → Matched this mock.
  await page.getByRole('button', { name: 'Test', exact: true }).first().click()
  const panel = page.getByRole('dialog', { name: 'Test this mock' })
  await panel.getByRole('button', { name: 'Send', exact: true }).click()
  await expect(panel.getByText('Matched this mock')).toBeVisible()
  await page.keyboard.press('Escape')

  // 4. Read the request log, through the guide again.
  await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('link', { name: 'Guide' }).click()
  await page.locator('section#getting-started').getByRole('link', { name: 'Open the request log →' }).click()
  await expect(page).toHaveURL(/\/requests$/)
  await expect(page.getByText(MOCK_PATH).first()).toBeVisible()

  // Every step is ticked: the checklist on Mocks has hidden itself for good.
  await page.goto('/mocks')
  // Kept per user: wmui.checklist.<user id>.done.
  await expect
    .poll(() => page.evaluate(() => Object.keys(localStorage).some((k) => /^wmui\.checklist\.[^.]+\.done$/.test(k) && localStorage.getItem(k) === '1')))
    .toBe(true)
  await expect(page.getByRole('heading', { name: 'Getting started' })).toBeHidden()
})

test('the side menu finds a section, and each page\'s help opens its part of the guide', async ({ page }) => {
  await signIn(page, USER_A)
  await page.goto('/guide')
  const menu = page.getByRole('navigation', { name: 'Contents' }).last()
  await menu.getByRole('searchbox', { name: 'Find a section' }).fill('nothing was')
  await expect(menu.getByRole('link')).toHaveText(['10Recording and snapshots', 'Nothing was recorded?'])
  await menu.getByRole('searchbox', { name: 'Find a section' }).press('Enter')
  await expect(page).toHaveURL(/\/guide#recording--nothing-was-recorded$/)
  await expect(page.locator('#recording--nothing-was-recorded')).toBeFocused()

  await page.goto('/scenarios')
  await page.getByRole('button', { name: /How this works/ }).click()
  const help = page.getByRole('dialog', { name: 'Scenarios and the builder' })
  await expect(help.getByRole('heading', { name: 'What it does in WireMock' })).toBeVisible()
  await help.getByRole('link', { name: 'Open the full guide' }).click()
  await expect(page).toHaveURL(/\/guide#scenarios$/)
  await expect(page.locator('#scenarios-title')).toBeFocused()
})
