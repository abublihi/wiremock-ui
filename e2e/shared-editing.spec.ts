import { expect, test } from '@playwright/test'
import { USER_A, USER_B, wiremockUrl } from './env'
import { signIn } from './helpers'

const basic = (user: { username: string; password: string }) =>
  `Basic ${Buffer.from(`${user.username}:${user.password}`).toString('base64')}`

const createPost = (userId: number) =>
  fetch(`${wiremockUrl()}/blog/shared-posts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId, title: 'Hello' }),
  })

// No authorization (spec A8): every signed-in user can edit and delete every mock.
test('one user edits and deletes a mock another user created', async ({ page, request }) => {
  const name = 'Alice’s post'
  const created = await request.post('/api/mocks', {
    headers: { Authorization: basic(USER_A) },
    data: {
      name,
      request: { method: 'POST', urlPath: '/blog/shared-posts' },
      response: { status: 200, jsonBody: { id: 201, title: 'Alice’s post' }, headers: { 'Content-Type': 'application/json' } },
    },
  })
  expect(created.status()).toBe(201)
  const { id } = (await created.json()) as { id: string }

  await signIn(page, USER_B)
  await page.goto('/mocks?owner=all')
  const row = page.getByRole('row', { name: new RegExp(name) })
  await expect(row).toContainText(USER_A.username)

  // User B opens Alice's mock and changes the answer to a validation error
  await row.getByRole('link', { name }).click()
  await expect(page.getByRole('heading', { name })).toBeVisible()
  await expect(page.getByText(/read-only/i)).toHaveCount(0)
  await page.getByRole('radio', { name: 'Validation error 400' }).click()
  await page.getByRole('button', { name: 'Save mock' }).click()
  await expect(page.getByText('Mock saved')).toBeVisible()
  const saved = await request.get(`/api/mocks/${id}`, { headers: { Authorization: basic(USER_A) } })
  const stub = (await saved.json()) as { response: { status: number }; metadata: { wiremockUi: { owner: string; updatedBy: string } } }
  expect(stub.response.status).toBe(400)
  expect(stub.metadata.wiremockUi).toMatchObject({ owner: USER_A.username, updatedBy: USER_B.username })
  await expect.poll(async () => (await createPost(2000000001)).status).toBe(400)

  // ...and deletes it from the list
  await page.goto('/mocks?owner=all')
  await page.getByRole('button', { name: `Actions for ${name}` }).click()
  await page.getByRole('menuitem', { name: 'Delete' }).click()
  await page.getByRole('alertdialog').getByRole('button', { name: 'Delete' }).click()
  await expect(page.getByText('Mock deleted')).toBeVisible()
  await expect(page.getByRole('row', { name: new RegExp(name) })).toHaveCount(0)
})

test('anyone can edit the baseline mock', async ({ page }) => {
  await signIn(page, USER_B)
  await page.goto('/mocks?owner=all')
  const row = page.getByRole('row', { name: /Blog health \(baseline\)/ })
  await expect(row).toContainText('Baseline')
  await row.getByRole('link', { name: 'Blog health (baseline)' }).click()

  await expect(page.getByText(/read-only/i)).toHaveCount(0)
  await page.getByRole('tab', { name: 'Advanced' }).click()
  const editor = page.getByRole('textbox', { name: 'Stub JSON' })
  await editor.click()
  await page.keyboard.press('ControlOrMeta+a')
  await page.keyboard.press('Delete')
  // CodeMirror closes brackets as you type, so insert the text in one go.
  await page.keyboard.insertText(
    JSON.stringify({
      name: 'Blog health (baseline)',
      request: { method: 'GET', urlPath: '/blog/health' },
      response: { status: 503, jsonBody: { status: 'down' }, headers: { 'Content-Type': 'application/json' } },
    }),
  )
  await page.getByRole('button', { name: 'Save mock' }).click()
  await expect(page.getByText('Mock saved')).toBeVisible()
  await expect.poll(async () => (await fetch(`${wiremockUrl()}/blog/health`)).status).toBe(503)
})

test('every signed-in user sees the whole navigation', async ({ page }) => {
  await signIn(page, USER_A)
  const nav = page.getByRole('navigation', { name: 'Main navigation' })
  for (const item of ['Mocks', 'Scenarios', 'Request log','Import & export', 'Users', 'Audit']) {
    await expect(nav.getByRole('link', { name: item })).toBeVisible()
  }
  await expect(page.getByRole('link', { name: 'New mock' }).first()).toBeVisible()
})
