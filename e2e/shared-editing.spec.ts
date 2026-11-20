import { expect, test } from '@playwright/test'
import { USER_A, USER_B, wiremockUrl } from './env'
import { signIn } from './helpers'

const basic = (user: { username: string; password: string }) =>
  `Basic ${Buffer.from(`${user.username}:${user.password}`).toString('base64')}`

const callNic = (idNo: string) =>
  fetch(`${wiremockUrl()}/nic/citizens/fetch`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ idNo }),
  })

// No authorization (spec A8): every signed-in user can edit and delete every mock.
test('one user edits and deletes a mock another user created', async ({ page, request }) => {
  const created = await request.post('/api/integrations/nic/endpoints/fetch-citizen/mocks', {
    headers: { Authorization: basic(USER_A) },
    data: { keyValue: '2000000001', status: 200, body: '{"idNo":"2000000001","name":"Alice’s citizen"}' },
  })
  expect(created.status()).toBe(201)
  const { id } = (await created.json()) as { id: string }
  const name = 'Fetch citizen — 2000000001'

  await signIn(page, USER_B)
  await page.goto('/mocks?owner=all')
  const row = page.getByRole('row', { name: new RegExp(name) })
  await expect(row).toContainText(USER_A.username)

  // User B opens Alice's mock and changes the answer to Not found
  await row.getByRole('link', { name }).click()
  await expect(page.getByRole('heading', { name })).toBeVisible()
  await expect(page.getByText(/read-only/i)).toHaveCount(0)
  await page.getByRole('radio', { name: 'Not found 404' }).click()
  await page.getByRole('button', { name: 'Save mock' }).click()
  await expect(page.getByText('Mock saved')).toBeVisible()
  const saved = await request.get(`/api/mocks/${id}`, { headers: { Authorization: basic(USER_A) } })
  const stub = (await saved.json()) as { response: { status: number }; metadata: { wiremockUi: { owner: string; updatedBy: string } } }
  expect(stub.response.status).toBe(404)
  expect(stub.metadata.wiremockUi).toMatchObject({ owner: USER_A.username, updatedBy: USER_B.username })
  await expect.poll(async () => (await callNic('2000000001')).status).toBe(404)

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
  const row = page.getByRole('row', { name: /NIC health \(baseline\)/ })
  await expect(row).toContainText('Baseline')
  await row.getByRole('link', { name: 'NIC health (baseline)' }).click()

  await expect(page.getByText(/read-only/i)).toHaveCount(0)
  await page.getByRole('tab', { name: 'Advanced' }).click()
  const editor = page.getByRole('textbox', { name: 'Stub JSON' })
  await editor.click()
  await page.keyboard.press('ControlOrMeta+a')
  await page.keyboard.press('Delete')
  // CodeMirror closes brackets as you type, so insert the text in one go.
  await page.keyboard.insertText(
    JSON.stringify({
      name: 'NIC health (baseline)',
      request: { method: 'GET', urlPath: '/nic/health' },
      response: { status: 503, jsonBody: { status: 'down' }, headers: { 'Content-Type': 'application/json' } },
    }),
  )
  await page.getByRole('button', { name: 'Save mock' }).click()
  await expect(page.getByText('Mock saved')).toBeVisible()
  await expect.poll(async () => (await fetch(`${wiremockUrl()}/nic/health`)).status).toBe(503)
})

test('every signed-in user sees the whole navigation', async ({ page }) => {
  await signIn(page, USER_A)
  const nav = page.getByRole('navigation', { name: 'Main navigation' })
  for (const item of ['Mocks', 'Request log', 'Scenarios', 'Catalog', 'Users', 'Audit', 'Import']) {
    await expect(nav.getByRole('link', { name: item })).toBeVisible()
  }
  await expect(page.getByRole('link', { name: 'New mock' }).first()).toBeVisible()
})
