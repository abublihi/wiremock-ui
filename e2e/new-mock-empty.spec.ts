import { expect, test } from '@playwright/test'
import { USER_A, wiremockUrl } from './env'
import { signIn } from './helpers'

// A fresh install has no integrations. The shared e2e stack is seeded (Blog API), so the first integrations list is
// answered empty here: what the page shows then, and the way from it to a served mock, is what this spec covers.
// Everything it creates is deleted afterwards.

const AUTH = { Authorization: `Basic ${Buffer.from(`${USER_A.username}:${USER_A.password}`).toString('base64')}` }
const KEY = 'e2e-blog'

type Stored = { id: string; name?: string; metadata: { wiremockUi: { version: number } } }

test.afterAll(async ({ request }) => {
  const mocks = (await (await request.get('/api/mocks', { headers: AUTH })).json()) as Stored[]
  for (const m of mocks.filter((m) => m.name === 'Blog posts — default' || m.name === 'GET /e2e-quick/health')) {
    await request.delete(`/api/mocks/${m.id}?version=${m.metadata.wiremockUi.version}`, { headers: AUTH })
  }
  await request.delete(`/api/integrations/${KEY}/endpoints/list-posts`, { headers: AUTH })
  await request.delete(`/api/integrations/${KEY}`, { headers: AUTH })
})

test('fresh install: New mock → add an integration → its first endpoint → a mock WireMock serves', async ({ page }) => {
  await signIn(page, USER_A)
  // Only the first load of the list is empty (a fresh install); the page then sees the real one.
  await page.route('**/api/integrations', (route) => (route.request().method() === 'GET' ? route.fulfill({ json: [] }) : route.fallback()), { times: 1 })
  await page.goto('/mocks/new')
  await expect(page.getByText('No integrations yet')).toBeVisible()
  await expect(page.getByRole('button', { name: /Mock a URL directly/ })).toBeVisible()
  await expect(page.getByRole('button', { name: /Start from blank JSON/ })).toBeVisible()

  await page.getByRole('button', { name: 'Add an integration' }).click()
  const dialog = page.getByRole('dialog', { name: 'Add integration' })
  await dialog.getByLabel('Key').fill(KEY)
  await dialog.getByLabel('Name').fill('Blog')
  await dialog.getByLabel('URL prefix').fill(`/${KEY}`)
  await dialog.getByRole('button', { name: 'Save' }).click()

  await expect(page).toHaveURL(new RegExp(`/integrations/${KEY}/endpoints/new\\?next=mock$`))
  await expect(page.getByRole('link', { name: 'Back to the new mock' })).toBeVisible()
  await page.getByLabel('Endpoint ID').fill('list-posts')
  await page.getByLabel('Name').fill('Blog posts')
  await page.getByRole('textbox', { name: 'Path' }).fill('/posts')
  await page.getByRole('button', { name: 'Save endpoint' }).click()

  await expect(page).toHaveURL(new RegExp(`/mocks/new\\?integration=${KEY}&endpoint=list-posts$`))
  await expect(page.getByText('// Blog → Blog posts')).toBeVisible()
  await page.getByRole('button', { name: 'Save mock' }).click()
  await expect(page.getByText('Mock saved')).toBeVisible()
  await expect(page).toHaveURL(/\/mocks\/[^/]+$/)
  await expect.poll(async () => (await fetch(`${wiremockUrl()}/${KEY}/posts`)).status).toBe(200)
})

test('Mock a URL directly: a quick mock is served and opens again in the same form', async ({ page }) => {
  await signIn(page, USER_A)
  await page.goto('/mocks/new')
  await page.getByRole('button', { name: 'Mock a URL directly' }).click()
  await page.getByRole('textbox', { name: 'URL' }).fill('/e2e-quick/health')
  await page.getByRole('button', { name: 'Save mock' }).click()
  await expect(page.getByText('Mock saved')).toBeVisible()
  await expect(page).toHaveURL(/\/mocks\/[^/]+$/)
  await expect.poll(async () => (await fetch(`${wiremockUrl()}/e2e-quick/health`)).status).toBe(200)

  await page.reload()
  await expect(page.getByRole('tab', { name: 'Simple' })).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByRole('textbox', { name: 'URL' })).toHaveValue('/e2e-quick/health')
})

test('old /catalog links land on Integrations with their search kept', async ({ page }) => {
  await signIn(page, USER_A)
  await page.goto('/catalog/blog/endpoints/new?next=mock')
  await expect(page).toHaveURL(/\/integrations\/blog\/endpoints\/new\?next=mock$/)
  await expect(page.getByRole('heading', { level: 1, name: 'Add endpoint' })).toBeVisible()
  const nav = page.getByRole('navigation', { name: 'Main navigation' })
  await expect(nav.getByRole('link', { name: 'Integrations' })).toHaveAttribute('data-status', 'active')
})
