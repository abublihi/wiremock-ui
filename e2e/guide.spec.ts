import { expect, test } from '@playwright/test'
import { USER_A, wiremockUrl } from './env'
import { signIn } from './helpers'

// A new user follows Getting started using only the guide's own links: integration → endpoint → mock → Test → the
// request log, and the Getting started checklist on Mocks ticks itself along the way. Everything it creates is
// deleted afterwards.

const AUTH = { Authorization: `Basic ${Buffer.from(`${USER_A.username}:${USER_A.password}`).toString('base64')}` }
const KEY = 'e2e-guide'

type Stored = { id: string; name?: string; metadata: { wiremockUi: { version: number; integration?: string } } }

test.afterAll(async ({ request }) => {
  const mocks = (await (await request.get('/api/mocks', { headers: AUTH })).json()) as Stored[]
  for (const m of mocks.filter((m) => m.metadata.wiremockUi.integration === KEY)) {
    await request.delete(`/api/mocks/${m.id}?version=${m.metadata.wiremockUi.version}`, { headers: AUTH })
  }
  await request.delete(`/api/integrations/${KEY}/endpoints/get-post`, { headers: AUTH })
  await request.delete(`/api/integrations/${KEY}`, { headers: AUTH })
})

test('Getting started, end to end, from the guide\'s links only', async ({ page }) => {
  await signIn(page, USER_A)
  // ? opens the guide from anywhere.
  await page.goto('/mocks')
  await page.locator('body').press('?')
  await expect(page).toHaveURL(/\/guide$/)
  const start = page.locator('section#getting-started')

  // 2. Add the integration.
  await start.getByRole('link', { name: 'Open Integrations →' }).click()
  await expect(page).toHaveURL(/\/integrations$/)
  await page.getByRole('button', { name: 'Add integration' }).first().click()
  const dialog = page.getByRole('dialog', { name: 'Add integration' })
  await dialog.getByLabel('Key').fill(KEY)
  await dialog.getByLabel('Name').fill('Blog API (guide)')
  await dialog.getByLabel('URL prefix').fill(`/${KEY}`)
  await dialog.getByRole('button', { name: 'Save' }).click()

  // 3. Add the endpoint: Get post, GET /posts/{id}, key = path variable id.
  await page.goto(`/integrations/${KEY}`)
  await page.getByRole('link', { name: 'Add endpoint' }).first().click()
  await page.getByLabel('Name').fill('Get post')
  await page.getByLabel('Endpoint ID').fill('get-post')
  await page.getByRole('radio', { name: 'Template' }).click()
  await page.getByRole('textbox', { name: 'Path' }).fill('/posts/{id}')
  await page.getByRole('combobox', { name: 'Where the key is' }).click()
  await page.getByRole('option', { name: 'Path variable' }).click()
  await page.getByLabel('Key expression').fill('id')
  await page.getByRole('button', { name: 'Save endpoint' }).click()

  // 4. Create a mock from the toast: id 42, Success.
  await page.getByRole('button', { name: 'New mock from this endpoint' }).click()
  await page.getByLabel('Value of path parameter id').fill('42')
  await page.getByRole('button', { name: 'Save mock' }).click()
  await expect(page.getByText('Mock saved')).toBeVisible()
  await expect.poll(async () => (await fetch(`${wiremockUrl()}/${KEY}/posts/42`)).status).toBe(200)

  // 5. Try it: Test → Send → Matched this mock.
  await page.getByRole('button', { name: 'Test', exact: true }).first().click()
  const panel = page.getByRole('dialog', { name: 'Test this mock' })
  await panel.getByRole('button', { name: 'Send', exact: true }).click()
  await expect(panel.getByText('Matched this mock')).toBeVisible()
  await page.keyboard.press('Escape')

  // 6. Read the request log, through the guide again.
  await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('link', { name: 'Guide' }).click()
  await page.locator('section#getting-started').getByRole('link', { name: 'Open the request log →' }).click()
  await expect(page).toHaveURL(/\/requests$/)
  await expect(page.getByText(`/${KEY}/posts/42`).first()).toBeVisible()

  // The checklist on Mocks has ticked every step.
  await page.goto('/mocks')
  await expect(page.getByRole('heading', { name: 'You are set up' })).toBeVisible()
  await expect(page.getByRole('progressbar', { name: 'Getting started progress' })).toHaveAttribute('aria-valuenow', '5')
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
