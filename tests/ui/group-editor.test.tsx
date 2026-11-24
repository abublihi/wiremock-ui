import userEvent from '@testing-library/user-event'
import { screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { setupServer } from 'msw/node'
import { toast } from 'sonner'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { buildGroupStubs, type GroupInput } from '@/server/mocks/groups'
import type { StubMapping } from '@/server/wiremock/types'
import { EditMockPage } from '@/ui/components/editor/EditMockPage'
import { renderApp } from './helpers'

const server = setupServer()
beforeAll(() => server.listen({ onUnhandledFrame: 'error' }))
afterEach(() => {
  server.resetHandlers()
  toast.dismiss()
})
afterAll(() => server.close())

const BASE = 'http://localhost:3000'
const input: GroupInput = {
  name: 'Establishment',
  request: { method: 'GET', urlType: 'template', url: '/est/{seq}' },
  by: { location: 'path', expression: 'seq' },
  responses: [
    { value: '1', response: { status: 200, body: 'active' } },
    { value: '2', response: { status: 200, body: 'expired' } },
  ],
  fallback: { response: { status: 404, body: 'none' } },
}
const stored = (i: GroupInput) =>
  buildGroupStubs(i, 'g1').map(
    (s, n) => ({ id: `s${n}`, ...s, metadata: { wiremockUi: { ...s.metadata.wiremockUi, owner: 'sara', version: 1, updatedAt: '', updatedBy: 'sara', source: 'ui' } } }) as unknown as StubMapping,
  )

describe('a mock with several responses', () => {
  it('opens as one, shows which row answers a value, and saves the whole group with every version it loaded', async () => {
    const stubs = stored(input)
    let put: { input: GroupInput; versions: Record<string, number> } | undefined
    server.use(
      http.get(`${BASE}/api/mocks/s0`, () => HttpResponse.json(stubs[0])),
      http.get(`${BASE}/api/mock-groups/g1`, () => HttpResponse.json(stubs)),
      http.get(`${BASE}/api/integrations`, () => HttpResponse.json([])),
      http.get(`${BASE}/api/tags`, () => HttpResponse.json([])),
      http.get(`${BASE}/api/config`, () => HttpResponse.json({ wiremockPublicUrl: 'http://localhost:8080', storeDriver: 'sqlite' })),
      http.put(`${BASE}/api/mock-groups/g1`, async ({ request }) => {
        put = (await request.json()) as typeof put
        return HttpResponse.json(stored(put!.input))
      }),
    )
    await renderApp(<EditMockPage id="s0" />)
    await screen.findByText('Responses · 3 (by seq)')
    expect(screen.getByText('// 3 responses · by seq')).toBeTruthy()
    const ue = userEvent.setup()

    const boxes = screen.getAllByRole('textbox', { name: 'When seq =' }) as HTMLInputElement[]
    expect(boxes.map((b) => b.value)).toEqual(['1', '2', '1'])
    const tryBox = boxes[2]!
    await ue.clear(tryBox)
    await ue.type(tryBox, '7')
    expect(screen.getByRole('status').textContent).toBe('→ 404 · “Any other seq”')
    await ue.clear(tryBox)
    await ue.type(tryBox, '2')
    expect(screen.getByRole('status').textContent).toBe('→ 200 · the response for seq = 2')

    // A third value, then a duplicate is refused before anything is sent.
    await ue.click(screen.getByRole('button', { name: 'Add a response for another value' }))
    // The rows' boxes come first; the last one is Try it's.
    const third = screen.getAllByRole('textbox', { name: 'When seq =' })[2] as HTMLInputElement
    expect(third.value).toBe('')
    await ue.type(third, '2')
    expect(await screen.findByText('Another response already has this value.')).toBeTruthy()
    await ue.clear(third)
    await ue.type(third, '3')
    await ue.click(screen.getByRole('radio', { name: 'No match' }))
    await ue.click(screen.getByRole('button', { name: 'Save mock' }))

    await waitFor(() => expect(put).toBeDefined())
    expect(put!.versions).toEqual({ s0: 1, s1: 1, s2: 1 })
    expect(put!.input.responses.map((r) => r.value)).toEqual(['1', '2', '3'])
    expect(put!.input.fallback).toBeNull()
    expect(put!.input.by).toEqual({ location: 'path', expression: 'seq' })
  })
})
