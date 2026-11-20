import { execFileSync } from 'node:child_process'
import { expect, test, type APIRequestContext } from '@playwright/test'
import { USER_A, wiremockUrl } from './env'
import { signIn } from './helpers'

const AUTH = { Authorization: `Basic ${Buffer.from(`${USER_A.username}:${USER_A.password}`).toString('base64')}` }

// Mocks made here are deleted after each test, so later specs see the seed catalog's mocks only.
let made: string[] = []
const remember = (id: string) => (made.push(id), id)
test.afterEach(async ({ request }) => {
  for (const id of made) {
    const res = await request.get(`/api/mocks/${id}`, { headers: AUTH })
    if (!res.ok()) continue
    const version = ((await res.json()) as { metadata: { wiremockUi: { version: number } } }).metadata.wiremockUi.version
    await request.delete(`/api/mocks/${id}?version=${version}`, { headers: AUTH })
  }
  made = []
})

async function createStub(request: APIRequestContext, stub: Record<string, unknown>): Promise<string> {
  const res = await request.post('/api/mocks', { headers: AUTH, data: stub })
  expect(res.status(), await res.text()).toBe(201)
  return remember(((await res.json()) as { id: string }).id)
}

test('the test panel matches a mock and its curl command works in a shell', async ({ page, context, request }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  const created = await request.post('/api/integrations/nic/endpoints/fetch-citizen/mocks', {
    headers: AUTH,
    data: { keyValue: '3000000003', status: 200, body: '{"idNo":"3000000003","name":"Curl citizen"}' },
  })
  expect(created.status()).toBe(201)
  const id = remember(((await created.json()) as { id: string }).id)

  await signIn(page, USER_A)
  await page.goto(`/mocks/${id}`)
  await page.getByRole('button', { name: 'Test', exact: true }).click()
  const panel = page.getByRole('dialog', { name: 'Test this mock' })
  await expect(panel.getByRole('textbox', { name: 'Path' })).toHaveValue('/nic/citizens/fetch')
  await panel.getByRole('button', { name: 'Send' }).click()
  await expect(panel.getByText('Matched this mock')).toBeVisible()
  await expect(panel.getByText('Curl citizen')).toBeVisible()

  await panel.getByRole('button', { name: 'Copy as curl' }).click()
  await expect(page.getByText('Copied curl command')).toBeVisible()
  const command = await page.evaluate(() => navigator.clipboard.readText())
  expect(command).toContain(`${wiremockUrl()}/nic/citizens/fetch`)
  // The command runs as is in a POSIX shell and gets the mock's answer.
  const output = execFileSync('sh', ['-c', `${command} -s`], { encoding: 'utf8' })
  expect(JSON.parse(output)).toEqual({ idNo: '3000000003', name: 'Curl citizen' })
})

test('Try it on an integration endpoint sends its example request', async ({ page }) => {
  await signIn(page, USER_A)
  await page.goto('/integrations/nic')
  await page.getByRole('button', { name: 'Try it: Fetch citizen' }).click()
  const panel = page.getByRole('dialog', { name: 'Try this endpoint' })
  await expect(panel.getByRole('textbox', { name: 'Body' })).toHaveValue('{"idNo":"1012345678"}')
  await panel.getByRole('button', { name: 'Send' }).click()
  await expect(panel.getByText(/Matched by|No match/).first()).toBeVisible()
})

test('a scenario answers pending then approved, and the page shows and resets the live state', async ({ page, request }) => {
  const scenario = 'e2e-loan'
  const base = { request: { method: 'GET', urlPath: '/e2e/loan/status' }, scenarioName: scenario }
  await createStub(request, {
    ...base,
    name: 'Loan pending',
    requiredScenarioState: 'Started',
    newScenarioState: 'approved',
    response: { status: 200, jsonBody: { status: 'pending' } },
  })
  await createStub(request, {
    ...base,
    name: 'Loan approved',
    requiredScenarioState: 'approved',
    response: { status: 200, jsonBody: { status: 'approved' } },
  })

  await signIn(page, USER_A)
  await page.goto('/scenarios')
  const card = page.getByRole('article', { name: scenario })
  await expect(card.getByText('Now in')).toContainText('Started')

  const call = async () => (await (await fetch(`${wiremockUrl()}/e2e/loan/status`)).json()) as { status: string }
  expect(await call()).toEqual({ status: 'pending' })
  expect(await call()).toEqual({ status: 'approved' })
  await expect(card.getByText('Now in')).toContainText('approved')

  await card.getByRole('button', { name: 'Reset' }).click()
  await expect(page.getByText(`${scenario} reset to Started`)).toBeVisible()
  await expect(card.getByText('Now in')).toContainText('Started')
  expect(await call()).toEqual({ status: 'pending' })
})

test('the scenario builder makes a 2-step scenario that the test panel runs step by step', async ({ page, request }) => {
  const scenario = 'e2e-builder'
  await signIn(page, USER_A)
  await page.goto('/scenarios')
  await page.getByRole('link', { name: 'New scenario' }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'New scenario' })).toBeVisible()
  await expect(page.getByText(/A scenario is a set of mocks for the same request/)).toBeVisible()

  await page.getByLabel('Scenario name').fill(scenario)
  await page.getByRole('option', { name: /Fetch citizen/ }).click()
  await page.getByLabel('Value of $.idNo in the request body').fill('6000000006')
  // Step 1 answers 200 with the catalog example; step 2 answers 404 with that status's example.
  await page.getByRole('textbox', { name: 'Step 2 state' }).fill('gone')
  await page.getByRole('spinbutton', { name: 'Step 2 response status' }).fill('404')
  await expect(page.getByRole('textbox', { name: 'Step 2 response body' })).toContainText('citizen not found')
  await page.getByRole('button', { name: 'Create scenario' }).click()

  await expect(page.getByText(`Scenario ${scenario} created with 2 steps`)).toBeVisible()
  await expect(page).toHaveURL(/\/scenarios\?scenario=e2e-builder$/)
  const listed = (await (await request.get('/api/scenarios', { headers: AUTH })).json()) as { scenarios: { name: string; mocks: { id: string }[] }[] }
  for (const m of listed.scenarios.find((s) => s.name === scenario)!.mocks) remember(m.id)

  const card = page.getByRole('article', { name: scenario })
  await expect(card.getByText('Now in')).toContainText('Started')
  await card.getByRole('link', { name: `${scenario} — Started` }).click()
  await page.getByRole('button', { name: 'Test', exact: true }).click()
  const panel = page.getByRole('dialog', { name: 'Test this mock' })
  await panel.getByRole('button', { name: 'Send' }).click()
  await expect(panel.getByText('Matched this mock')).toBeVisible()
  await expect(panel.getByText('Test Citizen')).toBeVisible()
  await panel.getByRole('button', { name: 'Send' }).click()
  await expect(panel.getByText('citizen not found')).toBeVisible()
  await expect(panel.getByText('Matched another mock')).toBeVisible()
})

test('editing a scenario as one unit: add a step after the last, save, and WireMock answers it', async ({ page, request }) => {
  const scenario = 'e2e-edit'
  for (const [requiredState, newState, body] of [
    ['Started', 'checked', '{"step":"one"}'],
    ['checked', undefined, '{"step":"two"}'],
  ] as const) {
    const res = await request.post('/api/integrations/nic/endpoints/fetch-citizen/mocks', {
      headers: AUTH,
      data: { keyValue: '7000000007', status: 200, body, name: `${scenario} — ${requiredState}`, scenario: { name: scenario, requiredState, ...(newState ? { newState } : {}) } },
    })
    expect(res.status(), await res.text()).toBe(201)
    remember(((await res.json()) as { id: string }).id)
  }

  await signIn(page, USER_A)
  await page.goto(`/scenarios?scenario=${scenario}`)
  await page.getByRole('article', { name: scenario }).getByRole('link', { name: 'Edit scenario' }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Edit scenario' })).toBeVisible()
  await expect(page.getByRole('textbox', { name: 'Step 2 state' })).toHaveValue('checked')
  await page.getByRole('button', { name: 'Add step' }).click()
  await page.getByRole('textbox', { name: 'Step 3 state' }).fill('gone')
  await page.getByRole('spinbutton', { name: 'Step 3 response status' }).fill('404')
  await page.getByRole('button', { name: 'Save scenario' }).click()
  await expect(page.getByText(`Scenario ${scenario} saved: 1 added, 1 changed, 0 removed`)).toBeVisible()
  await expect(page).toHaveURL(/\/scenarios\?scenario=e2e-edit$/)

  const mocks = (await (await request.get(`/api/mocks?scenario=${scenario}`, { headers: AUTH })).json()) as { id: string; requiredScenarioState: string }[]
  for (const m of mocks) remember(m.id)
  const gone = mocks.find((m) => m.requiredScenarioState === 'gone')!
  await request.post('/api/scenarios/reset', { headers: AUTH, data: { name: scenario } })

  const call = () =>
    fetch(`${wiremockUrl()}/nic/citizens/fetch`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ idNo: '7000000007' }) })
  expect(await (await call()).json()).toEqual({ step: 'one' })
  expect(await (await call()).json()).toEqual({ step: 'two' })
  const third = await call()
  expect(third.status).toBe(404)
  expect(third.headers.get('Matched-Stub-Id')).toBe(gone.id)
})

test('a proxy mock made in Simple mode forwards to the real service', async ({ page, request }) => {
  // The "real service" is WireMock itself, as seen from inside its container.
  await createStub(request, {
    name: 'Upstream citizen service',
    request: { method: 'POST', urlPath: '/upstream/citizens/fetch' },
    response: { status: 200, jsonBody: { from: 'upstream' } },
  })

  await signIn(page, USER_A)
  await page.goto('/mocks/new?integration=nic&endpoint=fetch-citizen')
  await page.getByLabel('Value of $.idNo in the request body').fill('4000000004')
  await page.getByRole('radio', { name: 'Forward to a real service' }).click()
  // /nic/citizens/fetch → strip /nic → http://localhost:8080/upstream/citizens/fetch
  await page.getByLabel('Service base URL').fill('http://localhost:8080/upstream')
  await page.getByLabel('Remove path prefix').fill('/nic')
  await page.getByRole('button', { name: 'Save mock' }).click()
  await expect(page.getByText('Mock saved')).toBeVisible()
  await expect(page).toHaveURL(/\/mocks\/[0-9a-f-]{36}$/)
  remember(page.url().split('/').pop()!)

  const hit = await fetch(`${wiremockUrl()}/nic/citizens/fetch`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ idNo: '4000000004' }),
  })
  expect(hit.status).toBe(200)
  expect(await hit.json()).toEqual({ from: 'upstream' })

  await page.goto('/mocks?owner=all')
  await expect(page.getByRole('row', { name: /Fetch citizen — 4000000004/ })).toContainText('Proxy')
})

test('an endpoint added on its own page is ready for a new mock', async ({ page, request }) => {
  await signIn(page, USER_A)
  await page.goto('/integrations/nic')
  await page.getByRole('link', { name: 'Add endpoint' }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Add endpoint' })).toBeVisible()
  await page.getByLabel('Name').fill('Citizen photo')
  await page.getByLabel('Endpoint ID').fill('citizen-photo')
  await page.getByLabel('Path', { exact: true }).fill('/citizens/{id}/photo')
  await page.getByRole('radio', { name: 'Template' }).click()
  await page.getByRole('combobox', { name: 'Where the key is' }).click()
  await page.getByRole('option', { name: 'Path variable' }).click()
  await page.getByLabel('Key expression').fill('id')
  const preview = page.getByRole('region', { name: 'How testers will see this' })
  await expect(preview).toContainText('Citizen photo')
  await expect(preview).toContainText('Value of path parameter id')
  await page.getByRole('button', { name: 'Save endpoint' }).click()
  await expect(page).toHaveURL(/\/integrations\/nic$/)
  await page.getByRole('button', { name: 'New mock from this endpoint' }).click()
  await expect(page).toHaveURL(/\/mocks\/new\?.*endpoint=citizen-photo/)
  await expect(page.getByLabel('Value of path parameter id')).toBeVisible()
  const removed = await request.delete('/api/integrations/nic/endpoints/citizen-photo', { headers: AUTH })
  expect(removed.status()).toBe(204)
})
