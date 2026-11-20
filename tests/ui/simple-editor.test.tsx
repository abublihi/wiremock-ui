import { useState } from 'react'
import userEvent from '@testing-library/user-event'
import { screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { setupServer } from 'msw/node'
import { toast } from 'sonner'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import type { Endpoint, Integration } from '@/server/catalog/types'
import { NewMockPage, type NewMockSearch } from '@/ui/components/editor/NewMockPage'
import { EditMockPage } from '@/ui/components/editor/EditMockPage'
import { renderApp } from './helpers'

const server = setupServer()
beforeAll(() => server.listen({ onUnhandledFrame: 'error' }))
afterEach(() => {
  server.resetHandlers()
  toast.dismiss() // sonner keeps toasts across renders; start each test with none
})
afterAll(() => server.close())

const BASE = 'http://localhost:3000'
const CATALOG = `${BASE}/api/integrations/nic/endpoints`

const integration: Integration = { key: 'nic', name: 'NIC', prefix: '/nic', updatedAt: '', updatedBy: '' }
const endpoint = (over: Partial<Endpoint> = {}): Endpoint => ({
  integration: 'nic',
  key: 'get-citizen-info',
  name: 'Fetch citizen',
  method: 'POST',
  path: '/nic-service/get-citizen-info',
  pathType: 'exact',
  lookup: { location: 'jsonPath', expression: '$.idNo' },
  contentType: 'json',
  exampleResponses: { '200': '{\n  "name": "Sara"\n}', '404': '{\n  "error": "not found"\n}' },
  allowedStatuses: [],
  description: 'Returns the citizen for an ID number.',
  links: [
    { label: 'Spec', url: 'https://docs.example.com/nic' },
    { label: 'Bad', url: 'javascript:alert(1)' },
  ],
  updatedAt: '',
  updatedBy: '',
  ...over,
})
const textEndpoint = () =>
  endpoint({
    key: 'ping',
    name: 'Ping',
    method: 'GET',
    path: '/ping',
    lookup: { location: 'query', expression: 'id' },
    contentType: 'text',
    exampleResponses: { '200': 'pong', '404': 'no such id', '500': 'boom' },
  })

type Call = { method: string; path: string; body?: unknown }
function mockCatalog(endpoints: Endpoint[], calls: Call[] = []) {
  server.use(
    http.get(`${BASE}/api/integrations`, () => HttpResponse.json([integration])),
    http.get(CATALOG, () => HttpResponse.json(endpoints)),
    http.post(`${CATALOG}/:endpoint/preview`, async ({ request, params }) => {
      const body = await request.json()
      calls.push({ method: 'POST', path: `preview:${String(params.endpoint)}`, body })
      return HttpResponse.json({ name: 'built', request: { method: 'POST' }, response: { status: 200 }, metadata: { wiremockUi: { integration: 'nic', endpoint: params.endpoint } } })
    }),
  )
  return calls
}

function NewHarness({ initial = {} }: { initial?: NewMockSearch }) {
  const [search, setSearch] = useState<NewMockSearch>(initial)
  return <NewMockPage search={search} onSearchChange={(next) => setSearch(next)} />
}

const bodyEditor = () => screen.getByRole('textbox', { name: 'Response body' })

describe('new mock — endpoint picker', () => {
  it('lists endpoints by integration and picking one prefills the body from the example', async () => {
    mockCatalog([endpoint()])
    await renderApp(<NewHarness />)
    const option = await screen.findByRole('option', { name: /Fetch citizen/ })
    expect(within(option).getByText('POST')).toBeTruthy()
    expect(within(option).getByText('/nic-service/get-citizen-info')).toBeTruthy()
    expect(screen.getByRole('group', { name: 'NIC' })).toBeTruthy()

    await userEvent.setup().click(option)
    expect(await screen.findByText('NIC → Fetch citizen')).toBeTruthy()
    await waitFor(() => expect(bodyEditor().textContent).toContain('"name": "Sara"'))
    expect(screen.getByLabelText('Value of $.idNo in the request body')).toBeTruthy()
  })

  it('filters endpoints as you type', async () => {
    mockCatalog([endpoint(), textEndpoint()])
    await renderApp(<NewHarness />)
    await screen.findByRole('option', { name: /Fetch citizen/ })
    await userEvent.setup().type(screen.getByRole('combobox', { name: 'Search endpoints' }), 'ping')
    await waitFor(() => expect(screen.queryByRole('option', { name: /Fetch citizen/ })).toBeNull())
    expect(screen.getByRole('option', { name: /Ping/ })).toBeTruthy()
  })

  it('shows the endpoint description and only http(s) links, opening in a new tab', async () => {
    mockCatalog([endpoint()])
    await renderApp(<NewHarness initial={{ integration: 'nic', endpoint: 'get-citizen-info' }} />)
    expect(await screen.findByText('Returns the citizen for an ID number.')).toBeTruthy()
    const link = screen.getByRole('link', { name: /Spec/ })
    expect(link.getAttribute('href')).toBe('https://docs.example.com/nic')
    expect(link.getAttribute('target')).toBe('_blank')
    expect(link.getAttribute('rel')).toBe('noopener noreferrer')
    expect(screen.queryByRole('link', { name: /Bad/ })).toBeNull()
  })
})

describe('new mock — Simple form', () => {
  it('a preset sets the status and refills the body until the user edits it', async () => {
    const calls = mockCatalog([textEndpoint()])
    server.use(
      http.post(`${CATALOG}/ping/mocks`, async ({ request }) => {
        calls.push({ method: 'POST', path: 'create', body: await request.json() })
        return HttpResponse.json({ id: 'm-2' }, { status: 201 })
      }),
    )
    await renderApp(<NewHarness initial={{ integration: 'nic', endpoint: 'ping' }} />)
    const ue = userEvent.setup()
    const body = (await screen.findByRole('textbox', { name: 'Response body' })) as HTMLTextAreaElement
    expect(body.value).toBe('pong')

    await ue.click(screen.getByRole('radio', { name: 'Not found 404' }))
    expect(body.value).toBe('no such id')

    await ue.clear(body)
    await ue.type(body, 'mine')
    await ue.click(screen.getByRole('radio', { name: 'Server error 500' }))
    expect(body.value).toBe('mine')

    await ue.click(screen.getByRole('radio', { name: 'Custom' }))
    const custom = screen.getByRole('spinbutton', { name: 'Custom status' }) as HTMLInputElement
    expect(custom.value).toBe('500')
    await ue.clear(custom)
    await ue.type(custom, '418')

    await ue.type(screen.getByLabelText('Value of query parameter id'), 'abc')
    await ue.click(screen.getByRole('button', { name: 'Save mock' }))
    await waitFor(() => expect(calls.find((c) => c.path === 'create')?.body).toEqual({ keyValue: 'abc', status: 418, body: 'mine' }))
  })

  it('a status without a catalog example keeps the body; an out-of-range custom status blocks preview and save', async () => {
    mockCatalog([textEndpoint()])
    await renderApp(<NewHarness initial={{ integration: 'nic', endpoint: 'ping' }} />)
    const ue = userEvent.setup()
    const body = (await screen.findByRole('textbox', { name: 'Response body' })) as HTMLTextAreaElement
    await ue.click(screen.getByRole('radio', { name: 'Custom' }))
    const custom = screen.getByRole('spinbutton', { name: 'Custom status' })
    await ue.clear(custom)
    await ue.type(custom, '99')
    expect(body.value).toBe('pong')
    expect(screen.getByText('Use a status between 100 and 599.')).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Preview' }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole('button', { name: 'Save mock' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('timeout sends 504 with a 30 s delay; a broken connection sends no status', async () => {
    const calls = mockCatalog([textEndpoint()])
    await renderApp(<NewHarness initial={{ integration: 'nic', endpoint: 'ping' }} />)
    const ue = userEvent.setup()
    await ue.click(await screen.findByRole('switch', { name: 'Default answer (when no key matches)' }))
    await ue.click(screen.getByRole('radio', { name: 'Timeout 504' }))
    expect((screen.getByRole('switch', { name: 'Slow response' }) as HTMLButtonElement).disabled).toBe(true)
    await ue.click(screen.getByRole('button', { name: 'Preview' }))
    await waitFor(() => expect(calls.at(-1)?.body).toEqual({ isDefault: true, status: 504, delayMs: 30_000 }))
    expect(await screen.findByRole('dialog', { name: 'Stub preview' })).toBeTruthy()
    await ue.keyboard('{Escape}')

    await ue.click(screen.getByRole('radio', { name: 'Success 200' }))
    await ue.click(screen.getByRole('switch', { name: 'Slow response' }))
    await ue.click(screen.getByRole('combobox', { name: 'Break the connection' }))
    await ue.click(await screen.findByRole('option', { name: 'Connection reset' }))
    expect((screen.getByRole('textbox', { name: 'Response body' }) as HTMLTextAreaElement).disabled).toBe(true)
    await ue.click(screen.getByRole('button', { name: 'Preview' }))
    await waitFor(() => expect(calls.at(-1)?.body).toEqual({ isDefault: true, fault: 'CONNECTION_RESET_BY_PEER', delayMs: 3000 }))
  })

  it('hides presets whose status the endpoint does not allow', async () => {
    mockCatalog([endpoint({ allowedStatuses: [200, 404] })])
    await renderApp(<NewHarness initial={{ integration: 'nic', endpoint: 'get-citizen-info' }} />)
    await screen.findByRole('radio', { name: 'Success 200' })
    expect(screen.getByRole('radio', { name: 'Not found 404' })).toBeTruthy()
    for (const hidden of ['Validation error', 'Server error', 'Timeout', 'Custom']) {
      expect(screen.queryByRole('radio', { name: new RegExp(`^${hidden}`) })).toBeNull()
    }
  })

  it('asks for the key value next to the key field before saving, in plain words', async () => {
    mockCatalog([endpoint()])
    server.use(http.post(`${CATALOG}/get-citizen-info/mocks`, () => HttpResponse.json({ error: 'keyValue is required' }, { status: 400 })))
    await renderApp(<NewHarness initial={{ integration: 'nic', endpoint: 'get-citizen-info' }} />)
    const ue = userEvent.setup()
    await ue.click(await screen.findByRole('button', { name: 'Save mock' }))
    const key = screen.getByLabelText('Value of $.idNo in the request body')
    await waitFor(() => expect(key.getAttribute('aria-invalid')).toBe('true'))
    const errorId = key.getAttribute('aria-describedby')!.split(' ').find((id) => document.getElementById(id)?.textContent === 'Enter the value this mock answers (for example 42), or turn on Default answer.')
    expect(errorId).toBeTruthy()
    expect(screen.queryByText('Could not save the mock')).toBeNull()
  })

  it('shows other server errors as a form-level alert', async () => {
    mockCatalog([endpoint()])
    server.use(http.post(`${CATALOG}/get-citizen-info/mocks`, () => HttpResponse.json({ error: 'WireMock is not reachable' }, { status: 502 })))
    await renderApp(<NewHarness initial={{ integration: 'nic', endpoint: 'get-citizen-info' }} />)
    const ue = userEvent.setup()
    await ue.type(await screen.findByLabelText('Value of $.idNo in the request body'), '1')
    await ue.click(screen.getByRole('button', { name: 'Save mock' }))
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('Could not save the mock')
    expect(alert.textContent).toContain('WireMock is not reachable')
  })

  it('saves to the catalog endpoint, toasts and opens the new mock', async () => {
    const calls = mockCatalog([endpoint()])
    server.use(
      http.post(`${CATALOG}/get-citizen-info/mocks`, async ({ request }) => {
        calls.push({ method: 'POST', path: 'create', body: await request.json() })
        return HttpResponse.json({ id: 'm-9', request: {}, response: {} }, { status: 201 })
      }),
    )
    const { router } = await renderApp(<NewHarness initial={{ integration: 'nic', endpoint: 'get-citizen-info' }} />)
    const ue = userEvent.setup()
    await ue.type(await screen.findByLabelText('Value of $.idNo in the request body'), '1234567890')
    expect((screen.getByLabelText(/^Name/) as HTMLInputElement).placeholder).toBe('Fetch citizen — 1234567890')
    await ue.click(screen.getByRole('button', { name: 'Save mock' }))
    await screen.findByText('Mock saved')
    expect(calls.filter((c) => c.path === 'create')).toHaveLength(1)
    expect(calls.find((c) => c.path === 'create')?.body).toEqual({ keyValue: '1234567890', status: 200, body: '{\n  "name": "Sara"\n}' })
    await waitFor(() => expect(router.state.location.pathname).toBe('/mocks/m-9'))
  })
})

describe('body from a file', () => {
  const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0, 1, 2, 255])
  function mockCreate(calls: Call[]) {
    server.use(
      http.post(`${CATALOG}/:endpoint/mocks`, async ({ request }) => {
        calls.push({ method: 'POST', path: 'create', body: await request.json() })
        return HttpResponse.json({ id: 'm-3', request: {}, response: {} }, { status: 201 })
      }),
    )
  }

  it('a binary file replaces the body with a "Binary body" card and saves base64Body with its type', async () => {
    const calls = mockCatalog([textEndpoint()])
    mockCreate(calls)
    await renderApp(<NewHarness initial={{ integration: 'nic', endpoint: 'ping' }} />)
    const ue = userEvent.setup({ applyAccept: false })
    await screen.findByRole('textbox', { name: 'Response body' })
    await ue.upload(screen.getByLabelText('Upload body from file'), new File([PNG], 'logo.png', { type: 'image/png' }))
    const card = await screen.findByRole('group', { name: 'Binary body' })
    expect(within(card).getByText('logo.png · 8 B · image/png')).toBeTruthy()
    expect(screen.queryByRole('textbox', { name: 'Response body' })).toBeNull()
    await ue.type(screen.getByLabelText('Value of query parameter id'), 'abc')
    await ue.click(screen.getByRole('button', { name: 'Save mock' }))
    await waitFor(() =>
      expect(calls.find((c) => c.path === 'create')?.body).toEqual({ keyValue: 'abc', status: 200, base64Body: 'iVBORwABAv8=', headers: { 'Content-Type': 'image/png' } }),
    )
  })

  it('Remove brings the text body back; a text file fills the body', async () => {
    mockCatalog([textEndpoint()])
    await renderApp(<NewHarness initial={{ integration: 'nic', endpoint: 'ping' }} />)
    const ue = userEvent.setup({ applyAccept: false })
    await screen.findByRole('textbox', { name: 'Response body' })
    await ue.upload(screen.getByLabelText('Upload body from file'), new File([PNG], 'logo.png', { type: 'image/png' }))
    await ue.click(within(await screen.findByRole('group', { name: 'Binary body' })).getByRole('button', { name: 'Remove' }))
    const body = (await screen.findByRole('textbox', { name: 'Response body' })) as HTMLTextAreaElement
    expect(body.value).toBe('')
    await ue.upload(screen.getByLabelText('Upload body from file'), new File(['a,b\n1,2'], 'rows.csv', { type: 'text/csv' }))
    await waitFor(() => expect(body.value).toBe('a,b\n1,2'))
  })

  it('refuses a file over 5 MB with a clear message', async () => {
    mockCatalog([textEndpoint()])
    await renderApp(<NewHarness initial={{ integration: 'nic', endpoint: 'ping' }} />)
    const ue = userEvent.setup({ applyAccept: false })
    await screen.findByRole('textbox', { name: 'Response body' })
    const big = new File(['x'], 'video.mp4')
    Object.defineProperty(big, 'size', { value: 5 * 1024 * 1024 + 1 })
    await ue.upload(screen.getByLabelText('Upload body from file'), big)
    expect(await screen.findByText(/video\.mp4 is 5\.0 MB\. A body file can be at most 5 MB/)).toBeTruthy()
    expect(screen.queryByRole('group', { name: 'Binary body' })).toBeNull()
  })

  it('a saved binary mock opens in Simple mode with its size and type', async () => {
    mockCatalog([endpoint()])
    server.use(
      http.get(`${BASE}/api/mocks/m-1`, () =>
        HttpResponse.json({
          id: 'm-1',
          name: 'Fetch citizen — 42',
          priority: 5,
          request: { method: 'POST', urlPath: '/nic/nic-service/get-citizen-info', bodyPatterns: [{ matchesJsonPath: { expression: '$.idNo', equalTo: '42' } }] },
          response: { status: 200, headers: { 'Content-Type': 'image/png' }, base64Body: 'iVBORwABAv8=' },
          metadata: { wiremockUi: { integration: 'nic', endpoint: 'get-citizen-info', owner: 'sara', version: 1, updatedAt: '', updatedBy: 'sara', source: 'ui' } },
        }),
      ),
    )
    await renderApp(<EditMockPage id="m-1" />)
    const card = await screen.findByRole('group', { name: 'Binary body' })
    expect(within(card).getByText('8 B · image/png')).toBeTruthy()
    expect((screen.getByRole('tab', { name: 'Simple' })).getAttribute('aria-selected')).toBe('true')
  })
})

describe('edit mock', () => {
  const stored = {
    id: 'm-1',
    name: 'Fetch citizen — 42',
    priority: 5,
    request: { method: 'POST', urlPath: '/nic/nic-service/get-citizen-info', bodyPatterns: [{ matchesJsonPath: { expression: '$.idNo', equalTo: '42' } }] },
    response: { status: 404, headers: { 'Content-Type': 'application/json' }, jsonBody: { error: 'gone' } },
    metadata: { wiremockUi: { integration: 'nic', endpoint: 'get-citizen-info', owner: 'baseline', version: 4, updatedAt: '', updatedBy: 'seed', source: 'seed' } },
  }

  it('rebuilds the form from the stub and saves through preview + PUT with the version', async () => {
    const calls = mockCatalog([endpoint()])
    server.use(
      http.get(`${BASE}/api/mocks/m-1`, () => HttpResponse.json(stored)),
      http.put(`${BASE}/api/mocks/m-1`, async ({ request }) => {
        calls.push({ method: 'PUT', path: 'update', body: await request.json() })
        return HttpResponse.json({ ...stored, metadata: { wiremockUi: { ...stored.metadata.wiremockUi, version: 5 } } })
      }),
    )
    const { router } = await renderApp(<EditMockPage id="m-1" />)
    const key = (await screen.findByLabelText('Value of $.idNo in the request body')) as HTMLInputElement
    expect(key.value).toBe('42')
    expect(screen.getByRole('radio', { name: 'Not found 404' }).getAttribute('aria-checked')).toBe('true')
    expect(bodyEditor().textContent).toContain('"error": "gone"')
    // Baseline mocks are editable like any other (no authorization in this deployment).
    expect(key.disabled).toBe(false)

    const ue = userEvent.setup()
    await ue.clear(key)
    await ue.type(key, '43')
    await ue.click(screen.getByRole('button', { name: 'Save mock' }))
    await screen.findByText('Mock saved')
    expect(calls.find((c) => c.path === 'preview:get-citizen-info')?.body).toEqual({ keyValue: '43', status: 404, body: '{\n  "error": "gone"\n}' })
    expect(calls.find((c) => c.path === 'update')?.body).toEqual({
      stub: { name: 'built', request: { method: 'POST' }, response: { status: 200 }, metadata: { wiremockUi: { integration: 'nic', endpoint: 'get-citizen-info' } } },
      version: 4,
    })
    // Saving an existing mock stays on it and the editor moves to the saved version.
    expect(router.state.location.pathname).toBe('/')
    expect(await screen.findByText(/version 5/)).toBeTruthy()
  })

  it('a stored custom status shows the Custom item selected even when the catalog would hide it', async () => {
    mockCatalog([endpoint({ allowedStatuses: [200, 404] })])
    server.use(http.get(`${BASE}/api/mocks/m-1`, () => HttpResponse.json({ ...stored, response: { ...stored.response, status: 418 } })))
    await renderApp(<EditMockPage id="m-1" />)
    const custom = await screen.findByRole('radio', { name: 'Custom' })
    expect(custom.getAttribute('aria-checked')).toBe('true')
    expect((screen.getByRole('spinbutton', { name: 'Custom status' }) as HTMLInputElement).value).toBe('418')
  })

  it('says so when the stub has options Simple mode cannot show', async () => {
    mockCatalog([endpoint()])
    server.use(
      http.get(`${BASE}/api/mocks/m-1`, () =>
        HttpResponse.json({ ...stored, response: { ...stored.response, transformers: ['response-template'] } }),
      ),
    )
    await renderApp(<EditMockPage id="m-1" />)
    // It opens in Advanced; the Simple tab explains why it can't help.
    expect((await screen.findByRole('tab', { name: 'Advanced' })).getAttribute('aria-selected')).toBe('true')
    await userEvent.setup().click(screen.getByRole('tab', { name: 'Simple' }))
    expect(await screen.findByText('This mock uses options Simple mode can’t show.')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Save mock' })).toBeNull()
  })

  it('shows the 409 conflict message', async () => {
    mockCatalog([endpoint()])
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
  const open = async () => {
    const calls = mockCatalog([textEndpoint()])
    await renderApp(<NewHarness initial={{ integration: 'nic', endpoint: 'ping' }} />)
    await screen.findByRole('textbox', { name: 'Response body' })
    return { calls, ue: userEvent.setup() }
  }

  it('forwarding hides the status and body, suggests the prefix and sends only proxy fields', async () => {
    const { calls, ue } = await open()
    await ue.click(screen.getByRole('switch', { name: 'Default answer (when no key matches)' }))
    await ue.click(screen.getByRole('radio', { name: 'Forward to a real service' }))
    expect(screen.queryByRole('textbox', { name: 'Response body' })).toBeNull()
    expect(screen.queryByRole('radio', { name: 'Success 200' })).toBeNull()
    expect((screen.getByRole('combobox', { name: 'Break the connection' }) as HTMLButtonElement).disabled).toBe(true)

    await ue.type(screen.getByRole('textbox', { name: 'Service base URL' }), 'https://real.example/api')
    const strip = screen.getByRole('textbox', { name: 'Remove path prefix' }) as HTMLInputElement
    expect(strip.value).toBe('') // a suggestion, not a default
    await ue.click(screen.getByRole('button', { name: 'Use /nic' }))
    expect(strip.value).toBe('/nic')
    expect(screen.getByText('// /nic/ping → https://real.example/api/ping')).toBeTruthy()
    await ue.click(screen.getByRole('button', { name: 'Add header' }))
    await ue.type(screen.getByRole('textbox', { name: 'Headers to add: Name' }), 'X-Env')
    await ue.type(screen.getByRole('textbox', { name: 'Headers to add: X-Env' }), 'qa')
    await ue.type(screen.getByRole('textbox', { name: 'Headers to remove' }), 'Authorization, Cookie')

    await ue.click(screen.getByRole('button', { name: 'Preview' }))
    await waitFor(() =>
      expect(calls.at(-1)?.body).toEqual({
        isDefault: true,
        proxy: { baseUrl: 'https://real.example/api', stripPrefix: '/nic', addHeaders: { 'X-Env': 'qa' }, removeHeaders: ['Authorization', 'Cookie'] },
      }),
    )
  })

  it('a missing or bad base URL is flagged on preview and nothing is sent', async () => {
    const { calls, ue } = await open()
    await ue.click(screen.getByRole('radio', { name: 'Forward to a real service' }))
    expect(screen.queryByText('Enter a URL that starts with http:// or https://.')).toBeNull()
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

  it('the call-back switch opens the webhook fields; its delay and body go along with the mock response', async () => {
    const { calls, ue } = await open()
    await ue.type(screen.getByLabelText('Value of query parameter id'), 'abc')
    expect(screen.queryByRole('textbox', { name: 'Callback URL' })).toBeNull()
    await ue.click(screen.getByRole('switch', { name: 'Call back after responding' }))
    await ue.type(screen.getByRole('textbox', { name: 'Callback URL' }), 'http://hooks.example/cb')
    await ue.click(screen.getByRole('combobox', { name: 'Method' }))
    await ue.click(await screen.findByRole('option', { name: 'PUT' }))
    expect(screen.getByText(/jsonPath originalRequest\.body/)).toBeTruthy()
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
    await waitFor(() =>
      expect(calls.at(-1)?.body).toEqual({
        keyValue: 'abc',
        status: 200,
        body: 'pong',
        webhook: { method: 'PUT', url: 'http://hooks.example/cb', delay: { type: 'uniform', lower: 50, upper: 100 } },
      }),
    )
  })

  it('a server 400 about the webhook URL lands on that field', async () => {
    const { ue } = await open()
    server.use(http.post(`${CATALOG}/ping/preview`, () => HttpResponse.json({ error: 'webhook.url must be an http:// or https:// URL' }, { status: 400 })))
    await ue.click(screen.getByRole('switch', { name: 'Default answer (when no key matches)' }))
    await ue.click(screen.getByRole('switch', { name: 'Call back after responding' }))
    await ue.type(screen.getByRole('textbox', { name: 'Callback URL' }), 'http://{{bad}}')
    await ue.click(screen.getByRole('button', { name: 'Preview' }))
    const url = screen.getByRole('textbox', { name: 'Callback URL' })
    await waitFor(() => expect(url.getAttribute('aria-invalid')).toBe('true'))
    expect(screen.getByText('webhook.url must be an http:// or https:// URL')).toBeTruthy()
  })
})
