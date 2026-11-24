import { expect, test } from '@playwright/test'
import { USER_A, wiremockUrl } from './env'
import { signIn } from './helpers'

const AUTH = { Authorization: `Basic ${Buffer.from(`${USER_A.username}:${USER_A.password}`).toString('base64')}` }
let made: string | undefined

test.afterAll(async ({ request }) => {
  if (!made) return
  const res = await request.get(`/api/mocks/${made}`, { headers: AUTH })
  if (!res.ok()) return
  const version = ((await res.json()) as { metadata: { wiremockUi: { version: number } } }).metadata.wiremockUi.version
  await request.delete(`/api/mocks/${made}?version=${version}`, { headers: AUTH })
})

test('a tester mocks creating a post, calls it, and reads why another call missed', async ({ page }) => {
  await signIn(page, USER_A)

  // New mock → POST /blog/qa-posts, answering Success
  await page.getByRole('link', { name: 'Mocks' }).click()
  await page.getByRole('link', { name: 'New mock' }).first().click()
  await page.getByRole('combobox', { name: 'Method' }).click()
  await page.getByRole('option', { name: 'POST' }).click()
  await page.getByRole('textbox', { name: 'URL' }).fill('/blog/qa-posts')
  await page.getByRole('radio', { name: 'Success 200' }).click()
  await page.getByRole('button', { name: 'Save mock' }).click()
  await expect(page.getByText('Mock saved')).toBeVisible()
  await expect(page).toHaveURL(/\/mocks\/[0-9a-f-]{36}$/)
  made = page.url().split('/').pop()!

  // WireMock serves it
  const hit = await fetch(`${wiremockUrl()}/blog/qa-posts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId: 7, title: 'Hello' }),
  })
  expect(hit.status).toBe(200)

  // A GET to the same URL misses
  expect((await fetch(`${wiremockUrl()}/blog/qa-posts`)).status).toBe(404)

  // The request log shows it with the No match stamp; opening it explains the near miss
  await page.getByRole('link', { name: 'Request log' }).click()
  const stamp = page.getByRole('button', { name: 'No match — see why' }).first()
  await expect(stamp).toBeVisible()
  await stamp.click()

  const drawer = page.getByRole('dialog', { name: 'GET /blog/qa-posts' })
  await expect(drawer).toBeVisible()
  const methodRow = drawer.getByRole('row', { name: /^method Mismatch/ })
  await expect(methodRow).toBeVisible()
  await expect(methodRow.getByRole('cell').nth(1)).toHaveText('equalTo POST')
  await expect(methodRow.getByRole('cell').nth(2)).toHaveText('GET')
})
