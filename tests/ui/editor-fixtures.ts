import { EditorView } from '@codemirror/view'
import { act, screen } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import type { SetupServer } from 'msw/node'
import type { Endpoint, Integration } from '@/server/catalog/types'
import type { StubMapping } from '@/server/wiremock/types'

export const BASE = 'http://localhost:3000'
export const CATALOG = `${BASE}/api/integrations/nic/endpoints`

export const integration: Integration = { key: 'nic', name: 'NIC', prefix: '/nic', updatedAt: '', updatedBy: '' }
export const endpoint: Endpoint = {
  integration: 'nic',
  key: 'get-citizen-info',
  name: 'Fetch citizen',
  method: 'POST',
  path: '/nic-service/get-citizen-info',
  pathType: 'exact',
  lookup: { location: 'jsonPath', expression: '$.idNo' },
  contentType: 'json',
  exampleResponses: { '200': '{\n  "name": "Sara"\n}' },
  allowedStatuses: [],
  updatedAt: '',
  updatedBy: '',
}

/** A catalog mock Simple mode can show (what the builder writes, plus the server fields). */
export const stored = (version = 3, over: Partial<StubMapping> = {}): StubMapping => ({
  id: 'm-1',
  name: 'Fetch citizen — 42',
  priority: 5,
  request: { method: 'POST', urlPath: '/nic/nic-service/get-citizen-info', bodyPatterns: [{ matchesJsonPath: { expression: '$.idNo', equalTo: '42' } }] },
  response: { status: 404, headers: { 'Content-Type': 'application/json' }, jsonBody: { error: 'gone' } },
  metadata: {
    wiremockUi: {
      integration: 'nic',
      endpoint: 'get-citizen-info',
      owner: 'sara',
      version,
      updatedAt: '2026-11-19T10:00:00.000Z',
      updatedBy: 'omar',
      source: 'ui',
    },
  },
  ...over,
})

export type Call = { method: string; path: string; body?: unknown }

/** Catalog + preview handlers; the preview echoes a stub built from the input so tests can see it. */
export function mockCatalog(server: SetupServer, calls: Call[] = []) {
  server.use(
    http.get(`${BASE}/api/integrations`, () => HttpResponse.json([integration])),
    http.get(CATALOG, () => HttpResponse.json([endpoint])),
    http.post(`${CATALOG}/:endpoint/preview`, async ({ request }) => {
      const input = (await request.json()) as { keyValue?: string; status?: number }
      calls.push({ method: 'POST', path: 'preview', body: input })
      const { id: _id, ...built } = stored(0, {
        name: `Fetch citizen — ${input.keyValue ?? 'default'}`,
        request: { ...stored().request, bodyPatterns: [{ matchesJsonPath: { expression: '$.idNo', equalTo: input.keyValue } }] },
        response: { status: input.status ?? 200, headers: { 'Content-Type': 'application/json' }, jsonBody: { error: 'gone' } },
      })
      return HttpResponse.json({ ...built, metadata: { wiremockUi: { integration: 'nic', endpoint: 'get-citizen-info' } } })
    }),
  )
  return calls
}

const jsonView = () => EditorView.findFromDOM(screen.getByRole('textbox', { name: 'Stub JSON' }))!

/** The Advanced editor's current text. */
export const jsonText = () => jsonView().state.doc.toString()

/** Replaces the Advanced editor's text as if the user had typed it. */
export function setJson(text: string) {
  const view = jsonView()
  act(() => view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text } }))
}
