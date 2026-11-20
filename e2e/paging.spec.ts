import { expect, test, type APIRequestContext } from '@playwright/test'
import { USER_A } from './env'
import { signIn } from './helpers'

// A session, not Basic auth: Basic checks the password (bcrypt) on every call, and this spec makes over a hundred.
let AUTH: Record<string, string> = {}
async function startSession(request: APIRequestContext) {
  const res = await request.post('/api/session', { data: USER_A })
  expect(res.ok()).toBe(true)
  AUTH = { 'X-CSRF-Token': ((await res.json()) as { csrfToken: string }).csrfToken }
}

// 60 plain mocks and one 3-step scenario, all named "pg-e2e …" so a search isolates them from other specs' mocks.
let made: string[] = []
test.afterEach(async ({ request }) => {
  for (const id of made) {
    const res = await request.get(`/api/mocks/${id}`, { headers: AUTH })
    expect(res.ok(), 'the cleanup runs in the same signed-in request context').toBe(true)
    const version = ((await res.json()) as { metadata: { wiremockUi: { version: number } } }).metadata.wiremockUi.version
    expect((await request.delete(`/api/mocks/${id}?version=${version}`, { headers: AUTH })).status()).toBe(204)
  }
  made = []
})

test('the mocks list pages: Next, the page in the URL, Back, and a scenario kept whole on its page', async ({ page, request }) => {
  await startSession(request)
  const create = async (stub: Record<string, unknown>) => {
    const res = await request.post('/api/mocks', { headers: AUTH, data: stub })
    expect(res.status(), await res.text()).toBe(201)
    made.push(((await res.json()) as { id: string }).id)
  }
  // Created first, so it is the oldest row: it lands on page 2.
  for (const [i, state] of ['Started', 'two', 'three'].entries()) {
    await create({
      name: `pg-e2e step ${i + 1}`,
      request: { method: 'GET', urlPath: '/pg-e2e/flow' },
      response: { status: 200, body: state },
      scenarioName: 'pg-e2e flow',
      requiredScenarioState: state,
      ...(i < 2 ? { newScenarioState: ['two', 'three'][i] } : {}),
    })
  }
  for (let i = 0; i < 60; i++) {
    await create({ name: `pg-e2e mock ${i}`, request: { method: 'GET', urlPath: `/pg-e2e/${i}` }, response: { status: 200 } })
  }

  // The API: limit/offset give one page of rows; without limit the plain array.
  const paged = (await (await request.get('/api/mocks?q=pg-e2e&limit=50', { headers: AUTH })).json()) as { total: number; totalMocks: number }
  expect(paged).toMatchObject({ total: 61, totalMocks: 63 })
  expect(((await (await request.get('/api/mocks?q=pg-e2e', { headers: AUTH })).json()) as unknown[]).length).toBe(63)

  await signIn(page, USER_A)
  await page.goto('/mocks?q=pg-e2e')
  const pager = page.getByRole('navigation', { name: 'Pages' })
  await expect(pager.getByText('Showing 1–50 of 61 rows (63 mocks — a scenario is one row)')).toBeVisible()
  await expect(page.getByRole('link', { name: 'pg-e2e mock 59' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'pg-e2e mock 9', exact: true })).toHaveCount(0)

  await pager.getByRole('button', { name: 'Next page' }).click()
  await expect(page).toHaveURL(/[?&]page=2/)
  await expect(pager.getByText('Showing 51–61 of 61 rows (63 mocks — a scenario is one row)')).toBeVisible()
  // A search is set, so the scenario group is open: all three steps on this page.
  await expect(page.getByRole('button', { name: 'Scenario: pg-e2e flow · 3 mocks' })).toHaveAttribute('aria-expanded', 'true')
  for (const n of [1, 2, 3]) await expect(page.getByRole('link', { name: `pg-e2e step ${n}` })).toBeVisible()

  await page.goBack()
  await expect(pager.getByText('Showing 1–50 of 61 rows (63 mocks — a scenario is one row)')).toBeVisible()

  // Changing a filter starts again at page 1.
  await page.goto('/mocks?q=pg-e2e&page=2')
  await page.getByRole('searchbox', { name: 'Search mocks' }).fill('pg-e2e mock')
  await expect(pager.getByText('Showing 1–50 of 60')).toBeVisible()
  await expect(page).not.toHaveURL(/page=/)
})
