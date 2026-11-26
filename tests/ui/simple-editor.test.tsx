import { useState } from 'react'
import userEvent from '@testing-library/user-event'
import { screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { setupServer } from 'msw/node'
import { toast } from 'sonner'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { buildQuickStub, type QuickMockInput } from '@/server/catalog/build'
import { NewMockPage, type NewMockSearch } from '@/ui/components/editor/NewMockPage'
import { EditMockPage } from '@/ui/components/editor/EditMockPage'
import { renderApp } from './helpers'

// The Simple form (a mock of a URL): presets, faults, proxy and webhook, body files, saving and editing.

const server = setupServer()
beforeAll(() => server.listen({ onUnhandledFrame: 'error' }))
afterEach(() => {
  server.resetHandlers()
  toast.dismiss() // sonner keeps toasts across renders; start each test with none
})
afterAll(() => server.close())

const BASE = 'http://localhost:3000'

type Call = { method: string; path: string; body?: unknown }
/** The preview runs the real quick builder; creating a mock answers with an id. */
function mockApi(calls: Call[] = []) {
  server.use(
    http.get(`${BASE}/api/tags`, () => HttpResponse.json([])),
    http.post(`${BASE}/api/mocks/preview`, async ({ request }) => {
      const body = (await request.json()) as QuickMockInput
      calls.push({ method: 'POST', path: 'preview', body })
      try {
        return HttpResponse.json(buildQuickStub(body))
      } catch (error) {
        return HttpResponse.json({ error: (error as Error).message }, { status: 400 })
      }
    }),
    http.post(`${BASE}/api/mocks`, async ({ request }) => {
      const body = (await request.json()) as Record<string, unknown>
      calls.push({ method: 'POST', path: 'create', body })
      return HttpResponse.json({ id: 'm-9', ...body }, { status: 201 })
    }),
  )
  return calls
}

function NewHarness({ initial = {} }: { initial?: NewMockSearch }) {
  const [search, setSearch] = useState<NewMockSearch>(initial)
  return <NewMockPage search={search} onSearchChange={(next) => setSearch(next)} />
}

/** The form for GET /ping answering text (a plain textarea body). */
async function openTextForm() {
  const ue = userEvent.setup({ applyAccept: false })
  await renderApp(<NewHarness />)
  const url = await screen.findByRole('textbox', { name: 'URL' })
  await ue.clear(url)
  await ue.type(url, '/ping')
  const type = screen.getByRole('textbox', { name: 'Response headers: Content-Type' })
  await ue.clear(type)
  await ue.type(type, 'text/plain')
  return ue
}
const lastPreview = (calls: Call[]) => calls.filter((c) => c.path === 'preview').at(-1)?.body

describe('new mock — Simple form', () => {
  it('a preset sets the status; a custom status is typed; Save previews, creates and opens the mock', async () => {
    const calls = mockApi()
    const ue = await openTextForm()
    await ue.click(screen.getByRole('radio', { name: 'Not found 404' }))
    await ue.click(screen.getByRole('radio', { name: 'Custom' }))
    const custom = screen.getByRole('spinbutton', { name: 'Custom status' }) as HTMLInputElement
    expect(custom.value).toBe('404')
    await ue.clear(custom)
    await ue.type(custom, '418')
    await ue.type(screen.getByRole('textbox', { name: 'Response body' }), 'teapot')
    await ue.click(screen.getByRole('button', { name: 'Save mock' }))
    await screen.findByText('Mock saved')
    expect(lastPreview(calls)).toEqual({ request: { method: 'GET', urlType: 'path', url: '/ping' }, status: 418, headers: { 'Content-Type': 'text/plain' }, body: 'teapot' })
    expect(calls.find((c) => c.path === 'create')?.body).toEqual({
      name: 'GET /ping',
      request: { method: 'GET', urlPath: '/ping' },
      response: { status: 418, headers: { 'Content-Type': 'text/plain' }, body: 'teapot' },
    })
  })

  it('an out-of-range custom status blocks preview and save', async () => {
    mockApi()
    const ue = await openTextForm()
    await ue.click(screen.getByRole('radio', { name: 'Custom' }))
    const custom = screen.getByRole('spinbutton', { name: 'Custom status' })
    await ue.clear(custom)
    await ue.type(custom, '99')
    expect(screen.getByText('Use a status between 100 and 599.')).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Preview' }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole('button', { name: 'Save mock' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('timeout sends 504 with a 30 s delay; a broken connection sends no status', async () => {
    const calls = mockApi()
    const ue = await openTextForm()
    await ue.click(screen.getByRole('radio', { name: 'Timeout 504' }))
    expect((screen.getByRole('switch', { name: 'Slow response' }) as HTMLButtonElement).disabled).toBe(true)
    await ue.click(screen.getByRole('button', { name: 'Preview' }))
    await waitFor(() => expect(lastPreview(calls)).toMatchObject({ status: 504, delayMs: 30_000 }))
    expect(await screen.findByRole('dialog', { name: 'Stub preview' })).toBeTruthy()
    await ue.keyboard('{Escape}')

    await ue.click(screen.getByRole('radio', { name: 'Success 200' }))
    await ue.click(screen.getByRole('switch', { name: 'Slow response' }))
    await ue.click(screen.getByRole('combobox', { name: 'Break the connection' }))
    await ue.click(await screen.findByRole('option', { name: 'Connection reset' }))
    expect((screen.getByRole('textbox', { name: 'Response body' }) as HTMLTextAreaElement).disabled).toBe(true)
    await ue.click(screen.getByRole('button', { name: 'Preview' }))
    await waitFor(() => expect(lastPreview(calls)).toEqual({ request: { method: 'GET', urlType: 'path', url: '/ping' }, fault: 'CONNECTION_RESET_BY_PEER', delayMs: 3000 }))
  })

  it('shows server errors on save as a form-level alert', async () => {
    mockApi()
    server.use(http.post(`${BASE}/api/mocks`, () => HttpResponse.json({ error: 'WireMock is not reachable' }, { status: 502 })))
    const ue = await openTextForm()
    await ue.click(screen.getByRole('button', { name: 'Save mock' }))
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('Could not save the mock')
    expect(alert.textContent).toContain('WireMock is not reachable')
  })
})

describe('body from a file', () => {
  const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0, 1, 2, 255])

  it('a binary file replaces the body with a "Binary body" card and saves base64Body with its type', async () => {
    const calls = mockApi()
    const ue = await openTextForm()
    await ue.upload(screen.getByLabelText('Upload body from file'), new File([PNG], 'logo.png', { type: 'image/png' }))
    const card = await screen.findByRole('group', { name: 'Binary body' })
    expect(within(card).getByText('logo.png · 8 B · image/png')).toBeTruthy()
    expect(screen.queryByRole('textbox', { name: 'Response body' })).toBeNull()
    await ue.click(screen.getByRole('button', { name: 'Save mock' }))
    await waitFor(() => expect(lastPreview(calls)).toMatchObject({ status: 200, base64Body: 'iVBORwABAv8=', headers: { 'Content-Type': 'image/png' } }))
  })

  it('Remove brings the text body back; a text file fills the body', async () => {
    mockApi()
    const ue = await openTextForm()
    await ue.upload(screen.getByLabelText('Upload body from file'), new File([PNG], 'logo.png', { type: 'image/png' }))
    await ue.click(within(await screen.findByRole('group', { name: 'Binary body' })).getByRole('button', { name: 'Remove' }))
    await ue.upload(screen.getByLabelText('Upload body from file'), new File(['a,b\n1,2'], 'rows.csv', { type: 'text/csv' }))
    await waitFor(() => expect((screen.getByRole('textbox', { name: 'Response body' }) as HTMLTextAreaElement).value).toBe('a,b\n1,2'))
  })

  it('refuses a file over 5 MB with a clear message', async () => {
    mockApi()
    const ue = await openTextForm()
    const big = new File(['x'], 'video.mp4')
    Object.defineProperty(big, 'size', { value: 5 * 1024 * 1024 + 1 })
    await ue.upload(screen.getByLabelText('Upload body from file'), big)
    expect(await screen.findByText(/video\.mp4 is 5\.0 MB\. A body file can be at most 5 MB/)).toBeTruthy()
    expect(screen.queryByRole('group', { name: 'Binary body' })).toBeNull()
  })
})

describe('edit mock', () => {
  const stored = {
    id: 'm-1',
    name: 'Find order',
    request: { method: 'POST', urlPath: '/orders/find' },
    response: { status: 404, headers: { 'Content-Type': 'application/json' }, jsonBody: { error: 'gone' } },
    metadata: { wiremockUi: { owner: 'baseline', version: 4, updatedAt: '', updatedBy: 'seed', source: 'seed' } },
  }

  it('rebuilds the form from the stub and saves through preview + PUT with the version', async () => {
    const calls = mockApi()
    server.use(
      http.get(`${BASE}/api/mocks/m-1`, () => HttpResponse.json(stored)),
      http.put(`${BASE}/api/mocks/m-1`, async ({ request }) => {
        calls.push({ method: 'PUT', path: 'update', body: await request.json() })
        return HttpResponse.json({ ...stored, metadata: { wiremockUi: { ...stored.metadata.wiremockUi, version: 5 } } })
      }),
    )
    await renderApp(<EditMockPage id="m-1" />)
    const url = (await screen.findByRole('textbox', { name: 'URL' })) as HTMLInputElement
    expect(url.value).toBe('/orders/find')
    expect(screen.getByRole('radio', { name: 'Not found 404' }).getAttribute('aria-checked')).toBe('true')
    const ue = userEvent.setup()
    await ue.clear(url)
    await ue.type(url, '/orders/search')
    await ue.click(screen.getByRole('button', { name: 'Save mock' }))
    await screen.findByText('Mock saved')
    expect(calls.find((c) => c.path === 'update')?.body).toEqual({
      stub: { name: 'Find order', request: { method: 'POST', urlPath: '/orders/search' }, response: { status: 404, headers: { 'Content-Type': 'application/json' }, jsonBody: { error: 'gone' } } },
      version: 4,
    })
    expect(await screen.findByText(/version 5/)).toBeTruthy()
  })

  it('says so when the stub has options Simple mode cannot show', async () => {
    mockApi()
    server.use(http.get(`${BASE}/api/mocks/m-1`, () => HttpResponse.json({ ...stored, response: { ...stored.response, transformers: ['response-template'] } })))
    await renderApp(<EditMockPage id="m-1" />)
    expect((await screen.findByRole('tab', { name: 'Advanced' })).getAttribute('aria-selected')).toBe('true')
    await userEvent.setup().click(screen.getByRole('tab', { name: 'Simple' }))
    expect(await screen.findByText('This mock uses options Simple mode can’t show.')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Save mock' })).toBeNull()
  })

  it('shows the 409 conflict message', async () => {
    mockApi()
    server.use(
      http.get(`${BASE}/api/mocks/m-1`, () => HttpResponse.json(stored)),
      http.put(`${BASE}/api/mocks/m-1`, () => HttpResponse.json({ error: 'version mismatch' }, { status: 409 })),
    )
    await renderApp(<EditMockPage id="m-1" />)
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Save mock' }))
    expect((await screen.findByRole('alert')).textContent).toContain('Someone changed this mock since you opened it.')
  })
})

describe('new mock — proxy and webhook', () => {
  it('forwarding hides the status and body, suggests the first path segment and sends only proxy fields', async () => {
    const calls = mockApi()
    const ue = await openTextForm()
    const url = screen.getByRole('textbox', { name: 'URL' })
    await ue.clear(url)
    await ue.type(url, '/shop/ping')
    await ue.click(screen.getByRole('radio', { name: 'Forward to a real service' }))
    expect(screen.queryByRole('textbox', { name: 'Response body' })).toBeNull()
    expect(screen.queryByRole('radio', { name: 'Success 200' })).toBeNull()
    expect((screen.getByRole('combobox', { name: 'Break the connection' }) as HTMLButtonElement).disabled).toBe(true)
    await ue.type(screen.getByRole('textbox', { name: 'Service base URL' }), 'https://real.example/api')
    await ue.click(screen.getByRole('button', { name: 'Add header' }))
    await ue.type(screen.getByRole('textbox', { name: 'Headers to add: Name' }), 'X-Env')
    await ue.type(screen.getByRole('textbox', { name: 'Headers to add: X-Env' }), 'qa')
    await ue.type(screen.getByRole('textbox', { name: 'Headers to remove' }), 'Authorization, Cookie')
    await ue.click(screen.getByRole('button', { name: 'Preview' }))
    await waitFor(() =>
      expect(lastPreview(calls)).toEqual({
        request: { method: 'GET', urlType: 'path', url: '/shop/ping' },
        proxy: { baseUrl: 'https://real.example/api', addHeaders: { 'X-Env': 'qa' }, removeHeaders: ['Authorization', 'Cookie'] },
      }),
    )
  })

  it('a missing or bad base URL is flagged on preview and nothing is sent', async () => {
    const calls = mockApi()
    const ue = await openTextForm()
    await ue.click(screen.getByRole('radio', { name: 'Forward to a real service' }))
    await ue.click(screen.getByRole('button', { name: 'Preview' }))
    const url = screen.getByRole('textbox', { name: 'Service base URL' })
    expect(url.getAttribute('aria-invalid')).toBe('true')
    expect(screen.getByText('Enter a URL that starts with http:// or https://.')).toBeTruthy()
    await ue.type(url, 'ftp://x')
    expect(url.getAttribute('aria-invalid')).toBe('true')
    await ue.type(screen.getByRole('textbox', { name: 'Remove path prefix' }), 'nic')
    expect(screen.getByText('Start the prefix with /.')).toBeTruthy()
    expect(calls).toHaveLength(0)
  })

  it('the call-back switch opens the webhook fields; its delay goes along with the mock response', async () => {
    const calls = mockApi()
    const ue = await openTextForm()
    expect(screen.queryByRole('textbox', { name: 'Callback URL' })).toBeNull()
    await ue.click(screen.getByRole('switch', { name: 'Call back after responding' }))
    await ue.type(screen.getByRole('textbox', { name: 'Callback URL' }), 'http://hooks.example/cb')
    // The request's Method comes first; the webhook's second.
    await ue.click(screen.getAllByRole('combobox', { name: 'Method' })[1]!)
    await ue.click(await screen.findByRole('option', { name: 'PUT' }))
    await ue.click(screen.getByRole('radio', { name: 'Random' }))
    const lower = screen.getByRole('spinbutton', { name: 'At least (ms)' })
    const upper = screen.getByRole('spinbutton', { name: 'At most (ms)' })
    await ue.clear(upper)
    await ue.type(upper, '100')
    expect(screen.getByText('Make the first number no larger than the second.')).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Preview' }) as HTMLButtonElement).disabled).toBe(true)
    await ue.clear(lower)
    await ue.type(lower, '50')
    await ue.click(screen.getByRole('button', { name: 'Preview' }))
    await waitFor(() => expect(lastPreview(calls)).toMatchObject({ status: 200, webhook: { method: 'PUT', url: 'http://hooks.example/cb', delay: { type: 'uniform', lower: 50, upper: 100 } } }))
  })

  it('a server 400 about the webhook URL lands on that field', async () => {
    mockApi()
    server.use(http.post(`${BASE}/api/mocks/preview`, () => HttpResponse.json({ error: 'webhook.url must be an http:// or https:// URL' }, { status: 400 })))
    const ue = await openTextForm()
    await ue.click(screen.getByRole('switch', { name: 'Call back after responding' }))
    await ue.type(screen.getByRole('textbox', { name: 'Callback URL' }), 'http://{{bad}}')
    await ue.click(screen.getByRole('button', { name: 'Preview' }))
    const url = screen.getByRole('textbox', { name: 'Callback URL' })
    await waitFor(() => expect(url.getAttribute('aria-invalid')).toBe('true'))
    expect(screen.getByText('This value must be an http:// or https:// URL.')).toBeTruthy()
  })
})

describe('header rows', () => {
  it('warns when a header name is listed twice (names ignore case)', async () => {
    const { HeaderRows } = await import('@/ui/components/editor/HeaderRows')
    await renderApp(<HeaderRows label="Headers" rows={[{ name: 'X-Id', value: '1' }, { name: 'x-id', value: '2' }]} onChange={() => {}} />)
    expect(screen.getByText('X-Id is listed more than once: only one value is kept.')).toBeTruthy()
  })
})

describe('new mock — a response for some requests', () => {
  it('adds a response chosen by a query parameter and saves the mock as one stub per response', async () => {
    const calls = mockApi()
    const { buildGroupStubs } = await import('@/server/mocks/groups')
    server.use(
      http.post(`${BASE}/api/mock-groups/preview`, async ({ request }) => {
        const { input } = (await request.json()) as { input: Parameters<typeof buildGroupStubs>[0] }
        return HttpResponse.json(buildGroupStubs(input, 'g-new'))
      }),
      http.post(`${BASE}/api/mock-groups`, async ({ request }) => {
        const body = (await request.json()) as { input: Parameters<typeof buildGroupStubs>[0] }
        calls.push({ method: 'POST', path: 'group', body })
        return HttpResponse.json(buildGroupStubs(body.input, 'g-new').map((b, i) => ({ id: `s-${i}`, ...b })), { status: 201 })
      }),
    )
    const ue = await openTextForm()
    expect(screen.queryByText('Choose the response by')).toBeNull()
    await ue.click(screen.getByRole('button', { name: 'Add a response for some requests' }))
    // The URL has no variable: the first condition is a query parameter to name.
    expect(screen.getByText('Choose the response by')).toBeTruthy()
    await ue.type(screen.getByRole('textbox', { name: 'Condition 1: name' }), 'id')
    // A response for no value at all is refused before anything is sent.
    await ue.click(screen.getByRole('button', { name: 'Save mock' }))
    expect(await screen.findByText('Enter a value for at least one condition.')).toBeTruthy()
    expect(calls.some((c) => c.path === 'group')).toBe(false)
    await ue.type(screen.getByRole('textbox', { name: '?id =' }), '7')
    expect(screen.getByRole('button', { name: 'Remove the response for ?id = 7' })).toBeTruthy()
    await ue.click(screen.getByRole('button', { name: 'Save mock' }))
    await waitFor(() => expect(calls.some((c) => c.path === 'group')).toBe(true))
    const saved = calls.find((c) => c.path === 'group')!.body as { input: Record<string, unknown> }
    expect(saved.input).toMatchObject({
      request: { method: 'GET', urlType: 'path', url: '/ping' },
      by: [{ location: 'query', expression: 'id' }],
      responses: [{ values: ['7'], response: { status: 200 } }],
      fallback: { response: { status: 200 } },
    })
  })

  it('removing the last added response goes back to one plain mock', async () => {
    const calls = mockApi()
    const ue = await openTextForm()
    await ue.click(screen.getByRole('button', { name: 'Add a response for some requests' }))
    await ue.click(screen.getByRole('button', { name: 'Remove the response for New response' }))
    expect(screen.queryByText('Choose the response by')).toBeNull()
    await ue.click(screen.getByRole('button', { name: 'Save mock' }))
    await screen.findByText('Mock saved')
    expect(calls.some((c) => c.path === 'create')).toBe(true)
  })
})
