import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { USER_A, wiremockUrl } from './env'
import { signIn } from './helpers'

const AUTH = { Authorization: `Basic ${Buffer.from(`${USER_A.username}:${USER_A.password}`).toString('base64')}` }
const TAG = 'shop-api'

test.afterAll(async ({ request }) => {
  const mocks = (await (await request.get(`/api/mocks?tag=${TAG}`, { headers: AUTH })).json()) as { id: string; metadata: { wiremockUi: { version: number } } }[]
  for (const m of mocks) await request.delete(`/api/mocks/${m.id}?version=${m.metadata.wiremockUi.version}`, { headers: AUTH })
})

test('a Postman collection is reviewed, imported as tagged mocks and served by WireMock', async ({ page }) => {
  await signIn(page, USER_A)
  await page.goto('/import')
  await page.getByLabel('Choose files').setInputFiles(join(process.cwd(), 'tests/fixtures/postman/shop-v2.1.json'))
  await expect(page.getByText(/Postman collection · \d+ requests → 8 mocks/)).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Review before importing' })).toBeVisible()
  // Every mock already carries the collection's tag; the dry run says each one is new.
  await expect(page.getByText('Already tagged in the file: they keep their tags.').first()).toBeVisible()
  await expect(page.getByText(/Creates 8/)).toBeVisible()
  await page.getByRole('button', { name: /^Import 8$/ }).click()
  const report = page.getByRole('region', { name: 'Import finished' })
  await expect(report.getByText('Created', { exact: true }).locator('xpath=following-sibling::dd')).toHaveText('8')

  const found = await fetch(`${wiremockUrl()}/api/orders/1`)
  expect(found.status).toBe(200)
  expect(await found.json()).toEqual({ id: 1, status: 'pending' })
  expect((await fetch(`${wiremockUrl()}/api/orders/999`)).status).toBe(404)
  const shipped = await fetch(`${wiremockUrl()}/api/orders?status=shipped`)
  expect(await shipped.json()).toEqual([{ id: 2 }])

  // The Mocks page finds them by their tag.
  await page.goto(`/mocks?owner=all&tag=${TAG}`)
  await expect(page.getByText('Get order', { exact: false }).first()).toBeVisible()
})
