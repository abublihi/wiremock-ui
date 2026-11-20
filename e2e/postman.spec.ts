import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { USER_A, wiremockUrl } from './env'
import { signIn } from './helpers'

const AUTH = { Authorization: `Basic ${Buffer.from(`${USER_A.username}:${USER_A.password}`).toString('base64')}` }
const KEY = 'e2e-postman'

test.afterAll(async ({ request }) => {
  const mocks = (await (await request.get(`/api/mocks?integration=${KEY}`, { headers: AUTH })).json()) as { id: string; metadata: { wiremockUi: { version: number } } }[]
  for (const m of mocks) await request.delete(`/api/mocks/${m.id}?version=${m.metadata.wiremockUi.version}`, { headers: AUTH })
  await request.delete(`/api/integrations/${KEY}`, { headers: AUTH })
})

test('a Postman collection is previewed, imported as one integration and served by WireMock', async ({ page }) => {
  await signIn(page, USER_A)
  await page.goto('/import')
  await page.getByLabel('Choose files').setInputFiles(join(process.cwd(), 'tests/fixtures/postman/shop-v2.1.json'))
  const preview = page.getByRole('region', { name: /Postman collection: Shop API/ })
  await expect(preview).toBeVisible()
  await preview.getByLabel('Key').fill(KEY)
  await preview.getByLabel('Prefix').fill(`/${KEY}`)
  await expect(preview.getByText(`/${KEY}/api/orders/{orderId}`)).toBeVisible()
  await preview.getByRole('button', { name: 'Import 5 endpoints and 8 mocks' }).click()
  const report = page.getByRole('region', { name: 'Import finished' })
  await expect(report.getByText('Created', { exact: true }).locator('xpath=following-sibling::dd')).toHaveText('8')

  const found = await fetch(`${wiremockUrl()}/${KEY}/api/orders/1`)
  expect(found.status).toBe(200)
  expect(await found.json()).toEqual({ id: 1, status: 'pending' })
  expect((await fetch(`${wiremockUrl()}/${KEY}/api/orders/999`)).status).toBe(404)
  const shipped = await fetch(`${wiremockUrl()}/${KEY}/api/orders?status=shipped`)
  expect(await shipped.json()).toEqual([{ id: 2 }])

  await report.getByRole('link', { name: 'Open Shop API in the catalog' }).click()
  await expect(page).toHaveURL(new RegExp(`/catalog/${KEY}$`))
  await expect(page.getByText('Get order', { exact: true })).toBeVisible()
})
