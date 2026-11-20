import { expect, test } from '@playwright/test'
import { USER_A, wiremockUrl } from './env'
import { signIn } from './helpers'

const KEY = '7'

test('a tester mocks creating a post, calls it, and reads why another call missed', async ({ page }) => {
  await signIn(page, USER_A)

  // New mock → Blog API → Create post
  await page.getByRole('link', { name: 'Mocks' }).click()
  await page.getByRole('link', { name: 'New mock' }).first().click()
  await page.getByPlaceholder('Search by integration, name or path…').fill('create post')
  await page.getByRole('option', { name: /Create post/ }).click()

  // Key mock answering Success with the catalog example
  await page.getByLabel('Value of $.userId in the request body').fill(KEY)
  await page.getByRole('radio', { name: 'Success 200' }).click()
  await page.getByRole('button', { name: 'Save mock' }).click()
  await expect(page.getByText('Mock saved')).toBeVisible()
  await expect(page).toHaveURL(/\/mocks\/[0-9a-f-]{36}$/)

  // WireMock serves it
  const hit = await fetch(`${wiremockUrl()}/blog/posts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId: 7, title: 'Hello', body: 'My first post.' }),
  })
  expect(hit.status).toBe(200)
  expect(await hit.json()).toEqual({ id: 101, userId: 7, title: 'Hello from the mock' })

  // An unknown key misses
  const miss = await fetch(`${wiremockUrl()}/blog/posts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId: 999, title: 'Hello' }),
  })
  expect(miss.status).toBe(404)

  // The request log shows it with the No match stamp; opening it explains the near miss
  await page.getByRole('link', { name: 'Request log' }).click()
  const stamp = page.getByRole('button', { name: 'No match — see why' }).first()
  await expect(stamp).toBeVisible()
  await stamp.click()

  const drawer = page.getByRole('dialog', { name: 'POST /blog/posts' })
  await expect(drawer).toBeVisible()
  const bodyRow = drawer.getByRole('row', { name: /^body Mismatch/ })
  await expect(bodyRow).toBeVisible()
  await expect(bodyRow.getByRole('cell').nth(1)).toHaveText(`matchesJsonPath $.userId equalTo ${KEY}`)
  await expect(bodyRow.getByRole('cell').nth(2)).toHaveText('999')
})
