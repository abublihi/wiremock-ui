import { EditorView } from '@codemirror/view'
import { act, screen } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import type { SetupServer } from 'msw/node'
import { buildQuickStub, type QuickMockInput } from '@/server/catalog/build'
import type { StubMapping } from '@/server/wiremock/types'

export const BASE = 'http://localhost:3000'

/** A mock of a URL the Simple form can show (what the quick builder writes, plus the server fields). */
export const stored = (version = 3, over: Partial<StubMapping> = {}): StubMapping => ({
  id: 'm-1',
  name: 'Find order',
  request: { method: 'POST', urlPath: '/orders/find', bodyPatterns: [{ equalToJson: '{"id": "42"}', ignoreExtraElements: true }] },
  response: { status: 404, headers: { 'Content-Type': 'application/json' }, jsonBody: { error: 'gone' } },
  metadata: {
    wiremockUi: {
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

/** Tags and the quick preview (through the real builder), so tests see what the form sends and gets back. */
export function mockCatalog(server: SetupServer, calls: Call[] = []) {
  server.use(
    http.get(`${BASE}/api/tags`, () => HttpResponse.json([])),
    http.post(`${BASE}/api/mocks/preview`, async ({ request }) => {
      const input = (await request.json()) as QuickMockInput
      calls.push({ method: 'POST', path: 'preview', body: input })
      try {
        return HttpResponse.json(buildQuickStub(input))
      } catch (error) {
        return HttpResponse.json({ error: (error as Error).message }, { status: 400 })
      }
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
