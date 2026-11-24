import { execFileSync } from 'node:child_process'
import { expect, test, type APIRequestContext } from '@playwright/test'
import { USER_A, wiremockUrl } from './env'
import { signIn } from './helpers'

const AUTH = { Authorization: `Basic ${Buffer.from(`${USER_A.username}:${USER_A.password}`).toString('base64')}` }

// Mocks made here are deleted after each test, so later specs see the seed's mocks only.
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
  const id = await createStub(request, {
    name: 'Curl post',
    request: { method: 'POST', urlPath: '/blog/curl-posts' },
    response: { status: 200, jsonBody: { id: 303, title: 'Curl post' }, headers: { 'Content-Type': 'application/json' } },
  })

  await signIn(page, USER_A)
  await page.goto(`/mocks/${id}`)
  await page.getByRole('button', { name: 'Test', exact: true }).click()
  const panel = page.getByRole('dialog', { name: 'Test this mock' })
  await expect(panel.getByRole('textbox', { name: 'Path' })).toHaveValue('/blog/curl-posts')
  await panel.getByRole('button', { name: 'Send' }).click()
  await expect(panel.getByText('Matched this mock')).toBeVisible()
  await expect(panel.locator('pre[aria-label="Body"]')).toContainText('Curl post')

  await panel.getByRole('button', { name: 'Copy as curl' }).click()
  await expect(page.getByText('Copied curl command')).toBeVisible()
  const command = await page.evaluate(() => navigator.clipboard.readText())
  expect(command).toContain(`${wiremockUrl()}/blog/curl-posts`)
  // The command runs as is in a POSIX shell and gets the mock's answer.
  const output = execFileSync('sh', ['-c', `${command} -s`], { encoding: 'utf8' })
  expect(JSON.parse(output)).toEqual({ id: 303, title: 'Curl post' })
})

test('a scenario answers pending then shipped, and the page shows and resets the live state', async ({ page, request }) => {
  const scenario = 'e2e-order'
  const base = { request: { method: 'GET', urlPath: '/e2e/orders/1001' }, scenarioName: scenario }
  await createStub(request, {
    ...base,
    name: 'Order pending',
    requiredScenarioState: 'Started',
    newScenarioState: 'shipped',
    response: { status: 200, jsonBody: { status: 'pending' } },
  })
  await createStub(request, {
    ...base,
    name: 'Order shipped',
    requiredScenarioState: 'shipped',
    response: { status: 200, jsonBody: { status: 'shipped' } },
  })

  await signIn(page, USER_A)
  await page.goto('/scenarios')
  const card = page.getByRole('article', { name: scenario })
  await expect(card.getByText('Now in')).toContainText('Started')

  const call = async () => (await (await fetch(`${wiremockUrl()}/e2e/orders/1001`)).json()) as { status: string }
  expect(await call()).toEqual({ status: 'pending' })
  expect(await call()).toEqual({ status: 'shipped' })
  await expect(card.getByText('Now in')).toContainText('shipped')

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
  await page.getByRole('combobox', { name: 'Method' }).click()
  await page.getByRole('option', { name: 'POST' }).click()
  await page.getByRole('textbox', { name: 'URL' }).fill('/blog/builder-posts')
  // Step 1 answers 200; step 2 answers 400.
  await page.getByRole('textbox', { name: 'Step 1 response body' }).fill('Hello from the mock')
  await page.getByRole('textbox', { name: 'Step 2 state' }).fill('gone')
  await page.getByRole('spinbutton', { name: 'Step 2 response status' }).fill('400')
  await page.getByRole('textbox', { name: 'Step 2 response body' }).fill('title is required')
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
  await expect(panel.getByText('Hello from the mock')).toBeVisible()
  await panel.getByRole('button', { name: 'Send' }).click()
  await expect(panel.getByText('title is required')).toBeVisible()
  await expect(panel.getByText('Matched another mock')).toBeVisible()
})

test('editing a scenario as one unit: add a step after the last, save, and WireMock answers it', async ({ page, request }) => {
  const scenario = 'e2e-edit'
  for (const [requiredState, newState, body] of [
    ['Started', 'checked', '{"step":"one"}'],
    ['checked', undefined, '{"step":"two"}'],
  ] as const) {
    await createStub(request, {
      name: `${scenario} — ${requiredState}`,
      request: { method: 'POST', urlPath: '/blog/edit-posts' },
      response: { status: 200, jsonBody: JSON.parse(body), headers: { 'Content-Type': 'application/json' } },
      scenarioName: scenario,
      requiredScenarioState: requiredState,
      ...(newState ? { newScenarioState: newState } : {}),
    })
  }

  await signIn(page, USER_A)
  await page.goto(`/scenarios?scenario=${scenario}`)
  await page.getByRole('article', { name: scenario }).getByRole('link', { name: 'Edit scenario' }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Edit scenario' })).toBeVisible()
  await expect(page.getByRole('textbox', { name: 'Step 2 state' })).toHaveValue('checked')
  await page.getByRole('button', { name: 'Add step' }).click()
  await page.getByRole('textbox', { name: 'Step 3 state' }).fill('gone')
  await page.getByRole('spinbutton', { name: 'Step 3 response status' }).fill('400')
  await page.getByRole('button', { name: 'Save scenario' }).click()
  await expect(page.getByText(`Scenario ${scenario} saved: 1 added, 1 changed, 0 removed`)).toBeVisible()
  await expect(page).toHaveURL(/\/scenarios\?scenario=e2e-edit$/)

  const mocks = (await (await request.get(`/api/mocks?scenario=${scenario}`, { headers: AUTH })).json()) as { id: string; requiredScenarioState: string }[]
  for (const m of mocks) remember(m.id)
  const gone = mocks.find((m) => m.requiredScenarioState === 'gone')!
  await request.post('/api/scenarios/reset', { headers: AUTH, data: { name: scenario } })

  const call = () =>
    fetch(`${wiremockUrl()}/blog/edit-posts`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: 'Hello' }) })
  expect(await (await call()).json()).toEqual({ step: 'one' })
  expect(await (await call()).json()).toEqual({ step: 'two' })
  const third = await call()
  expect(third.status).toBe(400)
  expect(third.headers.get('Matched-Stub-Id')).toBe(gone.id)
})

test('a proxy mock made in Simple mode forwards to the real service', async ({ page, request }) => {
  // The "real service" is WireMock itself, as seen from inside its container.
  await createStub(request, {
    name: 'Upstream blog service',
    request: { method: 'POST', urlPath: '/upstream/proxy-posts' },
    response: { status: 200, jsonBody: { from: 'upstream' } },
  })

  await signIn(page, USER_A)
  await page.goto('/mocks/new')
  await page.getByRole('combobox', { name: 'Method' }).click()
  await page.getByRole('option', { name: 'POST' }).click()
  await page.getByRole('textbox', { name: 'URL' }).fill('/blog/proxy-posts')
  await page.getByRole('radio', { name: 'Forward to a real service' }).click()
  // /blog/proxy-posts → strip /blog → http://localhost:8080/upstream/proxy-posts
  await page.getByLabel('Service base URL').fill('http://localhost:8080/upstream')
  await page.getByLabel('Remove path prefix').fill('/blog')
  await page.getByRole('button', { name: 'Save mock' }).click()
  await expect(page.getByText('Mock saved')).toBeVisible()
  await expect(page).toHaveURL(/\/mocks\/[0-9a-f-]{36}$/)
  remember(page.url().split('/').pop()!)

  const hit = await fetch(`${wiremockUrl()}/blog/proxy-posts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: 'Hello' }),
  })
  expect(hit.status).toBe(200)
  expect(await hit.json()).toEqual({ from: 'upstream' })

  await page.goto('/mocks?owner=all')
  await expect(page.getByRole('row', { name: /POST \/blog\/proxy-posts/ })).toContainText('Proxy')
})

test('a mock with several responses: a near miss adds a response for the value that missed', async ({ page, request }) => {
  const made = await request.post('/api/mock-groups', {
    headers: AUTH,
    data: {
      input: {
        name: 'Posts by user',
        request: { method: 'POST', urlType: 'path', url: '/blog/by-user' },
        by: { location: 'jsonPath', expression: '$.userId' },
        responses: [{ value: '7', response: { status: 200, body: '{"user":7}', headers: { 'Content-Type': 'application/json' } } }],
      },
    },
  })
  expect(made.status(), await made.text()).toBe(201)
  const stubs = (await made.json()) as { id: string; metadata: { wiremockUi: { group: { id: string } } } }[]
  const groupId = stubs[0]!.metadata.wiremockUi.group.id
  const post = (userId: number) =>
    fetch(`${wiremockUrl()}/blog/by-user`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ userId }) })
  try {
    expect((await post(7)).status).toBe(200)
    expect((await post(999)).status).toBe(404)

    await signIn(page, USER_A)
    await page.goto('/requests')
    await page.getByRole('button', { name: 'No match — see why' }).first().click()
    const drawer = page.getByRole('dialog', { name: 'POST /blog/by-user' })
    await drawer.getByRole('link', { name: 'Add a response for 999' }).click()
    // The router keeps a number-like value a string by quoting it: ?add=%22999%22.
    await expect(page).toHaveURL(/\/mocks\/[^/?]+\?add=(999|%22999%22)$/)
    await expect(page.getByText('Responses · 2 (by $.userId)')).toBeVisible()
    await page.getByRole('button', { name: 'Save mock' }).click()
    await expect(page.getByText('Mock saved')).toBeVisible()
    await expect.poll(async () => (await post(999)).status).toBe(200)

    // The list shows the mock once, with both responses.
    await page.goto('/mocks?owner=all')
    await expect(page.getByRole('button', { name: 'Show the responses of Posts by user' })).toHaveCount(1)
  } finally {
    await request.delete(`/api/mock-groups/${groupId}`, { headers: AUTH })
  }
})
