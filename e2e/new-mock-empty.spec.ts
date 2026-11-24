import { expect, test } from '@playwright/test'
import { USER_A, wiremockUrl } from './env'
import { signIn } from './helpers'

// New mock opens on the URL form; blank JSON is one click away. Old Integrations and Catalog links land on Mocks.
// Everything it creates is deleted afterwards.

const AUTH = { Authorization: `Basic ${Buffer.from(`${USER_A.username}:${USER_A.password}`).toString('base64')}` }

type Stored = { id: string; name?: string; metadata: { wiremockUi: { version: number } } }

test.afterAll(async ({ request }) => {
  const mocks = (await (await request.get('/api/mocks', { headers: AUTH })).json()) as Stored[]
  for (const m of mocks.filter((m) => m.name === 'GET /e2e-quick/health')) {
    await request.delete(`/api/mocks/${m.id}?version=${m.metadata.wiremockUi.version}`, { headers: AUTH })
  }
})

test('New mock: a URL mock is served and opens again in the same form', async ({ page }) => {
  await signIn(page, USER_A)
  await page.goto('/mocks/new')
  await expect(page.getByRole('button', { name: /Start from blank JSON/ })).toBeVisible()
  await page.getByRole('textbox', { name: 'URL' }).fill('/e2e-quick/health')
  await page.getByRole('button', { name: 'Save mock' }).click()
  await expect(page.getByText('Mock saved')).toBeVisible()
  await expect(page).toHaveURL(/\/mocks\/[^/]+$/)
  await expect.poll(async () => (await fetch(`${wiremockUrl()}/e2e-quick/health`)).status).toBe(200)

  await page.reload()
  await expect(page.getByRole('tab', { name: 'Simple' })).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByRole('textbox', { name: 'URL' })).toHaveValue('/e2e-quick/health')
})

test('Start from blank JSON opens the JSON editor, and Use the form goes back', async ({ page }) => {
  await signIn(page, USER_A)
  await page.goto('/mocks/new')
  await page.getByRole('button', { name: 'Start from blank JSON' }).click()
  await expect(page).toHaveURL(/\/mocks\/new\?mode=json$/)
  await expect(page.getByRole('textbox', { name: 'Stub JSON' })).toBeVisible()
  await page.getByRole('button', { name: 'Use the form' }).click()
  await expect(page.getByRole('textbox', { name: 'URL' })).toBeVisible()
})

test('old Integrations and Catalog links land on Mocks', async ({ page }) => {
  await signIn(page, USER_A)
  for (const old of ['/integrations', '/integrations/blog/endpoints/new?next=mock', '/catalog/blog']) {
    await page.goto(old)
    await expect(page).toHaveURL(/\/mocks(\?.*)?$/)
    await expect(page.getByRole('heading', { level: 1, name: 'Mocks' })).toBeVisible()
  }
  const nav = page.getByRole('navigation', { name: 'Main navigation' })
  await expect(nav.getByRole('link', { name: 'Integrations' })).toHaveCount(0)
})
