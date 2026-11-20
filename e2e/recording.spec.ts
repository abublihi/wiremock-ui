import { expect, test } from '@playwright/test'
import { USER_A, upstream, wiremockUrl } from './env'
import { signIn } from './helpers'

const AUTH = { Authorization: `Basic ${Buffer.from(`${USER_A.username}:${USER_A.password}`).toString('base64')}` }

let made: string[] = []
test.afterEach(async ({ request }) => {
  for (const id of made) {
    const res = await request.get(`/api/mocks/${id}`, { headers: AUTH })
    if (!res.ok()) continue
    const version = ((await res.json()) as { metadata: { wiremockUi: { version: number } } }).metadata.wiremockUi.version
    await request.delete(`/api/mocks/${id}?version=${version}`, { headers: AUTH })
  }
  made = []
  await request.post('/api/recordings/stop', { headers: AUTH }).catch(() => {})
})

test('record a real service, review the stub and accept it: WireMock then answers with the mock', async ({ page }) => {
  const up = upstream()
  await fetch(`${up.url}/__admin/mappings`, {
    method: 'POST',
    body: JSON.stringify({
      request: { method: 'GET', urlPath: '/rec/greeting' },
      response: { status: 200, jsonBody: { hello: 'from the real service' }, headers: { 'Content-Type': 'application/json' } },
    }),
  })

  await signIn(page, USER_A)
  await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('link', { name: 'Recording' }).click()
  await page.getByLabel('Target URL').fill(up.internal)
  await page.getByRole('button', { name: 'Start recording' }).click()
  const banner = page.getByRole('status').filter({ hasText: 'Recording traffic to' })
  await expect(banner).toContainText(`Recording traffic to ${up.internal}`)

  // The app under test calls WireMock; WireMock forwards to the real service and records the answer.
  const proxied = await fetch(`${wiremockUrl()}/rec/greeting`)
  expect(await proxied.json()).toEqual({ hello: 'from the real service' })

  await banner.getByRole('button', { name: 'Stop' }).click()
  await expect(page.getByText('Recorded answers may contain real data')).toBeVisible()
  await expect(banner).toHaveCount(0)
  // Nothing is a mock yet: WireMock has no stub for the path any more.
  expect((await fetch(`${wiremockUrl()}/rec/greeting`)).status).toBe(404)

  const row = page.getByRole('listitem').filter({ hasText: '/rec/greeting' })
  await row.getByLabel('Name').fill('Greeting (recorded)')
  await page.getByRole('button', { name: 'Accept 1 selected' }).click()
  await expect(page).toHaveURL(/\/mocks\/[0-9a-f-]{36}$/)
  made.push(page.url().split('/').at(-1)!)
  // Accepted mocks open in the Simple editor (the quick URL form) when it can show them.
  await expect(page.getByRole('tab', { name: 'Simple' })).toHaveAttribute('data-state', 'active')

  const answered = await fetch(`${wiremockUrl()}/rec/greeting`)
  expect(answered.status).toBe(200)
  expect(await answered.json()).toEqual({ hello: 'from the real service' })
})
