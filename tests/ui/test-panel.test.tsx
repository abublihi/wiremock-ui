import type { ReactNode } from 'react'
import userEvent from '@testing-library/user-event'
import { screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { setupServer } from 'msw/node'
import { toast } from 'sonner'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import type { TestRequestResult } from '@/server/wiremock/relay'
import type { LoggedEvent } from '@/server/wiremock/types'
import { EditMockPage } from '@/ui/components/editor/EditMockPage'
import { toRelayInput } from '@/ui/components/editor/TestPanel'
import { MockRowActions } from '@/ui/components/mocks/MockActions'
import { RequestDrawer } from '@/ui/components/requests/RequestDrawer'
import { ServerConfigProvider } from '@/ui/config'
import { BASE, CATALOG, endpoint, mockCatalog, stored } from './editor-fixtures'
import { renderApp } from './helpers'

const server = setupServer()
beforeAll(() => server.listen({ onUnhandledFrame: 'error' }))
afterEach(() => {
  server.resetHandlers()
  toast.dismiss()
})
afterAll(() => server.close())

const PUBLIC = 'http://mocks.test:8080'
const withConfig = (ui: ReactNode) => (
  <ServerConfigProvider config={{ storeDriver: 'sqlite', wiremockPublicUrl: PUBLIC, recordingAllowed: true }}>{ui}</ServerConfigProvider>
)

const result = (over: Partial<TestRequestResult> = {}): TestRequestResult => ({
  status: 200,
  headers: { 'content-type': 'application/json', 'matched-stub-id': 'm-1' },
  body: '{"name":"Sara"}',
  bodyIsBase64: false,
  bodyTruncated: false,
  durationMs: 14,
  matchedStubId: 'm-1',
  ...over,
})

/** The edit page for mock m-1 (a key mock on $.idNo = 42) with a catalog example request, and a relay that records calls. */
function editPage(answer: TestRequestResult | { error: string; status: number } = result()) {
  const sent: unknown[] = []
  mockCatalog(server)
  server.use(
    http.get(CATALOG, () => HttpResponse.json([{ ...endpoint, exampleRequest: '{"idNo": "0", "lang": "en"}' }])),
    http.get(`${BASE}/api/mocks/m-1`, () => HttpResponse.json(stored())),
    http.post(`${BASE}/api/test-request`, async ({ request }) => {
      sent.push(await request.json())
      return 'error' in answer ? HttpResponse.json({ error: answer.error }, { status: answer.status }) : HttpResponse.json(answer)
    }),
  )
  return sent
}

async function openPanel() {
  await renderApp(withConfig(<EditMockPage id="m-1" />))
  const ue = userEvent.setup()
  await ue.click(await screen.findByRole('button', { name: 'Test' }))
  const panel = await screen.findByRole('dialog', { name: 'Test this mock' })
  return { ue, panel }
}

describe('test panel from the editor', () => {
  it('starts from the mock: method, concrete path, the key in the example body, Content-Type', async () => {
    editPage()
    const { panel } = await openPanel()
    expect(within(panel).getByRole('combobox', { name: 'Method' }).textContent).toBe('POST')
    expect((within(panel).getByRole('textbox', { name: 'Path' }) as HTMLInputElement).value).toBe('/nic/nic-service/get-citizen-info')
    expect(JSON.parse((within(panel).getByRole('textbox', { name: 'Body' }) as HTMLTextAreaElement).value)).toEqual({ idNo: '42', lang: 'en' })
    expect((within(panel).getByRole('textbox', { name: 'Headers: Content-Type' }) as HTMLInputElement).value).toBe('application/json')
  })

  it('sends through the relay and shows status, time, "Matched this mock", headers and the pretty body', async () => {
    const sent = editPage()
    const { ue, panel } = await openPanel()
    await ue.click(within(panel).getByRole('button', { name: 'Send' }))
    expect(await within(panel).findByText('Matched this mock')).toBeTruthy()
    expect(sent).toEqual([
      {
        method: 'POST',
        path: '/nic/nic-service/get-citizen-info',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idNo: '42', lang: 'en' }, null, 2),
      },
    ])
    expect(within(panel).getByText('200')).toBeTruthy()
    expect(within(panel).getByText('14 ms')).toBeTruthy()
    expect(within(panel).getByText('matched-stub-id')).toBeTruthy()
    expect(within(panel).getByLabelText('Body', { selector: 'pre' }).textContent).toBe('{\n  "name": "Sara"\n}')
  })

  it('sends the edited request: path, a new query parameter, no removed header', async () => {
    const sent = editPage()
    const { ue, panel } = await openPanel()
    const path = within(panel).getByRole('textbox', { name: 'Path' })
    await ue.clear(path)
    await ue.type(path, '/nic/other')
    await ue.click(within(panel).getByRole('button', { name: 'Add parameter' }))
    await ue.type(within(panel).getByRole('textbox', { name: 'Query parameters: Name' }), 'page')
    await ue.type(within(panel).getByRole('textbox', { name: 'Query parameters: page' }), '2')
    await ue.click(within(panel).getByRole('button', { name: 'Remove Content-Type' }))
    await ue.click(within(panel).getByRole('button', { name: 'Send' }))
    await within(panel).findByText('Matched this mock')
    expect(sent[0]).toMatchObject({ method: 'POST', path: '/nic/other', query: { page: '2' } })
    expect(sent[0]).not.toHaveProperty('headers')
  })

  it('names another mock that matched instead, with a link to it', async () => {
    editPage(result({ matchedStubId: 'm-2' }))
    server.use(http.get(`${BASE}/api/mocks/m-2`, () => HttpResponse.json(stored(1, { id: 'm-2', name: 'Catch-all citizen' }))))
    const { ue, panel } = await openPanel()
    await ue.click(within(panel).getByRole('button', { name: 'Send' }))
    expect(await within(panel).findByText('Matched another mock:')).toBeTruthy()
    const link = await within(panel).findByRole('link', { name: 'Catch-all citizen' })
    expect(link.getAttribute('href')).toBe('/mocks/m-2')
  })

  it('says forwarding failed (not No match) when a forwarding mock could not reach its service, with the Docker hint', async () => {
    editPage({
      ...result({ status: 500, matchedStubId: 'm-1', headers: {}, body: 'Network failure trying to make a proxied request' }),
      forwardError: { message: 'Connect to localhost:3999 failed: Connection refused', target: 'http://localhost:3999' },
    } as TestRequestResult)
    const { ue, panel } = await openPanel()
    await ue.click(within(panel).getByRole('button', { name: 'Send' }))
    expect(await within(panel).findByText('Matched this mock, but forwarding to http://localhost:3999 failed')).toBeTruthy()
    expect(within(panel).getByText('Connect to localhost:3999 failed: Connection refused')).toBeTruthy()
    expect(within(panel).getAllByText(/host\.docker\.internal/).length).toBeGreaterThan(0)
    expect(within(panel).queryByText('No match')).toBeNull()
  })

  it('shows the No match stamp and links to the unmatched requests', async () => {
    editPage(result({ status: 404, matchedStubId: null, headers: {}, body: '' }))
    const { ue, panel } = await openPanel()
    await ue.click(within(panel).getByRole('button', { name: 'Send' }))
    expect(await within(panel).findByText('No match')).toBeTruthy()
    expect(within(panel).getByRole('link', { name: 'See unmatched requests' }).getAttribute('href')).toBe('/requests?matched=%22false%22') // the router JSON-encodes search values
  })

  it('says a binary body is not shown and that a long one was cut', async () => {
    editPage(result({ body: 'AAECAw==', bodyIsBase64: true, bodyTruncated: true }))
    const { ue, panel } = await openPanel()
    await ue.click(within(panel).getByRole('button', { name: 'Send' }))
    expect(await within(panel).findByText('// binary body (4 B) — not shown')).toBeTruthy()
    expect(within(panel).getByText('// body cut at 1 MB')).toBeTruthy()
  })

  it('shows the relay’s refusal', async () => {
    editPage({ error: "path must not target WireMock's admin API (/__admin)", status: 400 })
    const { ue, panel } = await openPanel()
    await ue.click(within(panel).getByRole('button', { name: 'Send' }))
    const alert = await within(panel).findByRole('alert')
    expect(alert.textContent).toContain('Could not send the request')
    expect(alert.textContent).toContain("path must not target WireMock's admin API (/__admin)")
  })

  it('does not send a body with GET', async () => {
    const sent = editPage()
    const { ue, panel } = await openPanel()
    await ue.click(within(panel).getByRole('combobox', { name: 'Method' }))
    await ue.click(await screen.findByRole('option', { name: 'GET' }))
    expect(within(panel).getByText('GET and HEAD requests are sent without a body.')).toBeTruthy()
    await ue.click(within(panel).getByRole('button', { name: 'Send' }))
    await within(panel).findByText('Matched this mock')
    expect(sent[0]).not.toHaveProperty('body')
  })
})

describe('copy as curl', () => {
  it('the editor header copies a curl that matches the saved mock', async () => {
    editPage()
    const writeText = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue()
    await renderApp(withConfig(<EditMockPage id="m-1" />))
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Copy as curl' }))
    expect(await screen.findByText('Copied curl command')).toBeTruthy()
    expect(writeText).toHaveBeenCalledWith(
      [
        `curl '${PUBLIC}/nic/nic-service/get-citizen-info' \\`,
        '  -X POST \\',
        `  -H 'Content-Type: application/json' \\`,
        `  --data-raw '{`,
        `  "idNo": "42",`,
        `  "lang": "en"`,
        `}'`,
      ].join('\n'),
    )
  })

  it('falls back to a hidden textarea when the Clipboard API is not available', async () => {
    editPage()
    const ue = userEvent.setup() // user-event installs its own clipboard: take it away afterwards
    const clipboard = navigator.clipboard
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined })
    const copied: string[] = []
    const exec = vi.fn((command: string) => {
      copied.push(document.querySelector<HTMLTextAreaElement>('textarea[readonly]')?.value ?? '')
      return command === 'copy'
    })
    Object.defineProperty(document, 'execCommand', { configurable: true, value: exec })
    try {
      await renderApp(withConfig(<EditMockPage id="m-1" />))
      await ue.click(await screen.findByRole('button', { name: 'Copy as curl' }))
      expect(await screen.findByText('Copied curl command')).toBeTruthy()
      expect(exec).toHaveBeenCalledWith('copy')
      expect(copied[0]).toMatch(/^curl 'http:\/\/mocks\.test:8080\/nic\/nic-service\/get-citizen-info'/)
      expect(document.querySelector('textarea[readonly]')).toBeNull()
    } finally {
      Object.defineProperty(navigator, 'clipboard', { configurable: true, value: clipboard })
    }
  })

  it('the panel copies the request as edited', async () => {
    editPage()
    const writeText = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue()
    const { ue, panel } = await openPanel()
    const path = within(panel).getByRole('textbox', { name: 'Path' })
    await ue.clear(path)
    await ue.type(path, '/x')
    await ue.click(within(panel).getByRole('button', { name: 'Copy as curl' }))
    await waitFor(() => expect(writeText).toHaveBeenCalled())
    expect(writeText.mock.calls[0]![0]).toMatch(new RegExp(`^curl '${PUBLIC}/x' \\\\\n  -X POST`))
  })

  it('the mock list row menu copies a curl, with the catalog example as the body', async () => {
    server.use(http.get(CATALOG, () => HttpResponse.json([{ ...endpoint, exampleRequest: '{"idNo": "0"}' }])))
    await renderApp(withConfig(<MockRowActions stub={stored()} />))
    const ue = userEvent.setup()
    // The command still needs the catalog when the item is clicked: it goes to the clipboard as a ClipboardItem
    // promise, written during the click (Safari only allows that).
    expect(typeof window.ClipboardItem).toBe('function')
    await ue.click(screen.getByRole('button', { name: 'Actions for Fetch citizen — 42' }))
    await ue.click(await screen.findByRole('menuitem', { name: 'Copy as curl' }))
    expect(await screen.findByText('Copied curl command')).toBeTruthy()
    expect(await navigator.clipboard.readText()).toContain(`--data-raw '{\n  "idNo": "42"\n}'`)
  })
})

const loggedEvent: LoggedEvent = {
  id: 'e-1',
  wasMatched: true,
  request: {
    url: '/nic/nic-service/get-citizen-info?trace=1',
    method: 'POST',
    headers: { Host: 'localhost:8080', 'Content-Type': 'application/json', 'Content-Length': '13' },
    body: '{"idNo":"42"}',
    loggedDateString: '2026-11-20T10:00:00Z',
  },
  response: { status: 200, headers: {}, body: '{}' },
  stubMapping: stored(),
}

describe('request log drawer', () => {
  function drawer() {
    const sent: unknown[] = []
    server.use(
      http.get(`${BASE}/api/requests/e-1`, () => HttpResponse.json(loggedEvent)),
      http.get(`${BASE}/api/mocks/m-1`, () => HttpResponse.json(stored())),
      http.post(`${BASE}/api/test-request`, async ({ request }) => {
        sent.push(await request.json())
        return HttpResponse.json(result())
      }),
    )
    return sent
  }

  it('copies the logged request as curl', async () => {
    drawer()
    const writeText = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue()
    await renderApp(withConfig(<RequestDrawer id="e-1" onClose={() => {}} />))
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Copy as curl' }))
    await waitFor(() => expect(writeText).toHaveBeenCalled())
    expect(writeText.mock.calls[0]![0]).toBe(
      [
        `curl '${PUBLIC}/nic/nic-service/get-citizen-info?trace=1' \\`,
        '  -X POST \\',
        `  -H 'Content-Type: application/json' \\`,
        `  --data-raw '{"idNo":"42"}'`,
      ].join('\n'),
    )
  })

  it('Resend opens the panel with the logged request and sends it', async () => {
    const sent = drawer()
    await renderApp(withConfig(<RequestDrawer id="e-1" onClose={() => {}} />))
    const ue = userEvent.setup()
    await ue.click(await screen.findByRole('button', { name: 'Resend' }))
    const panel = await screen.findByRole('dialog', { name: 'Resend request' })
    await ue.click(within(panel).getByRole('button', { name: 'Send' }))
    expect(await within(panel).findByText('Matched by')).toBeTruthy()
    expect(await within(panel).findByRole('link', { name: 'Fetch citizen — 42' })).toBeTruthy()
    expect(sent).toEqual([
      {
        method: 'POST',
        path: '/nic/nic-service/get-citizen-info',
        query: { trace: '1' },
        headers: { 'Content-Type': 'application/json' },
        body: '{"idNo":"42"}',
      },
    ])
  })
})

describe('relay input', () => {
  it('joins repeated headers with ", " but repeated Cookie headers with "; "', () => {
    const input = toRelayInput({
      method: 'GET',
      path: '/x',
      query: [],
      headers: [
        { name: 'Cookie', value: 'a=1' },
        { name: 'cookie', value: 'b=2' },
        { name: 'Accept', value: 'text/plain' },
        { name: 'Accept', value: 'application/json' },
      ],
      body: '',
    })
    expect(input.headers).toEqual({ Cookie: 'a=1; b=2', Accept: 'text/plain, application/json' })
  })
})
