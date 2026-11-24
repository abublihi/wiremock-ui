import userEvent from '@testing-library/user-event'
import { screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { setupServer } from 'msw/node'
import { toast } from 'sonner'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { EditMockPage } from '@/ui/components/editor/EditMockPage'
import { BASE, type Call, mockCatalog, stored } from './editor-fixtures'
import { renderApp } from './helpers'

const server = setupServer()
beforeAll(() => server.listen({ onUnhandledFrame: 'error' }))
afterEach(() => {
  server.resetHandlers()
  toast.dismiss()
  vi.useRealTimers()
})
afterAll(() => server.close())

const NOW = new Date('2026-11-19T12:00:00.000Z')
const version = (n: number, updatedBy: string, updatedAt: string, status: number) => {
  const stub = stored(n, { response: { status, headers: { 'Content-Type': 'application/json' }, jsonBody: { v: n } } })
  stub.metadata!.wiremockUi = { ...stub.metadata!.wiremockUi!, updatedBy, updatedAt }
  return stub
}

function historyServer(calls: Call[]) {
  let current = stored(3)
  mockCatalog(server)
  server.use(
    http.get(`${BASE}/api/mocks/m-1`, () => HttpResponse.json(current)),
    http.get(`${BASE}/api/mocks/m-1/history`, () =>
      HttpResponse.json([version(2, 'omar', '2026-11-19T09:00:00.000Z', 500), version(1, 'sara', '2026-11-17T12:00:00.000Z', 201)]),
    ),
    http.post(`${BASE}/api/mocks/m-1/restore`, async ({ request }) => {
      const body = (await request.json()) as { version: number }
      calls.push({ method: 'POST', path: 'restore', body })
      current = version(4, 'sara', NOW.toISOString(), 500)
      return HttpResponse.json(current)
    }),
  )
}

describe('history', () => {
  it('lists previous versions newest first with who and when', async () => {
    vi.useFakeTimers({ now: NOW, toFake: ['Date'] })
    historyServer([])
    await renderApp(<EditMockPage id="m-1" />)
    await userEvent.setup().click(await screen.findByRole('button', { name: 'History' }))
    const sheet = await screen.findByRole('dialog', { name: 'Version history' })
    const items = within(await within(sheet).findByRole('list', { name: 'Earlier versions' })).getAllByRole('button')
    expect(items.map((i) => i.textContent)).toEqual([
      expect.stringMatching(/^Version 2.*omar.*3 hours ago/),
      expect.stringMatching(/^Version 1.*sara.*2 days ago/),
    ])
  })

  it('selecting a version shows its JSON; restore posts the version and toasts', async () => {
    const calls: Call[] = []
    historyServer(calls)
    await renderApp(<EditMockPage id="m-1" />)
    const ue = userEvent.setup()
    await ue.click(await screen.findByRole('button', { name: 'History' }))
    const sheet = await screen.findByRole('dialog', { name: 'Version history' })
    const second = await within(sheet).findByRole('button', { name: /^Version 1/ })
    await ue.click(second)
    expect(second.getAttribute('aria-pressed')).toBe('true')
    await waitFor(() => expect(within(sheet).getByRole('textbox', { name: 'Version 1 JSON' }).textContent).toContain('"status": 201'))

    await ue.click(within(sheet).getByRole('button', { name: 'Restore this version' }))
    expect(await screen.findByText('Version 1 restored')).toBeTruthy()
    expect(calls).toEqual([{ method: 'POST', path: 'restore', body: { version: 1 } }])
    // The editor (no unsaved changes) now shows the restored live version.
    await waitFor(() => expect(screen.getByText(/version 4/)).toBeTruthy())
  })

  it('restoring while a draft exists keeps the draft and says what saving it will do', async () => {
    const calls: Call[] = []
    historyServer(calls)
    await renderApp(<EditMockPage id="m-1" />)
    const ue = userEvent.setup()
    const key = (await screen.findByRole('textbox', { name: 'URL' })) as HTMLInputElement
    await ue.type(key, '9')
    const draft = key.value
    await ue.click(screen.getByRole('button', { name: 'History' }))
    const sheet = await screen.findByRole('dialog', { name: 'Version history' })
    await ue.click(await within(sheet).findByRole('button', { name: /^Version 1/ }))
    await ue.click(within(sheet).getByRole('button', { name: 'Restore this version' }))
    expect(await screen.findByText('Version 1 restored')).toBeTruthy()
    expect(screen.getByText('Your unsaved changes are kept — saving them will ask you to reload.')).toBeTruthy()
    expect(calls).toEqual([{ method: 'POST', path: 'restore', body: { version: 1 } }])
    expect((screen.getByRole('textbox', { name: 'URL', hidden: true }) as HTMLInputElement).value).toBe(draft)
  })

  it('restoring without a draft has no draft note', async () => {
    historyServer([])
    await renderApp(<EditMockPage id="m-1" />)
    const ue = userEvent.setup()
    await ue.click(await screen.findByRole('button', { name: 'History' }))
    const sheet = await screen.findByRole('dialog', { name: 'Version history' })
    await ue.click(await within(sheet).findByRole('button', { name: /^Version 1/ }))
    await ue.click(within(sheet).getByRole('button', { name: 'Restore this version' }))
    await screen.findByText('Version 1 restored')
    expect(screen.queryByText(/unsaved changes are kept/)).toBeNull()
  })

  it('says so when there are no previous versions', async () => {
    mockCatalog(server)
    server.use(
      http.get(`${BASE}/api/mocks/m-1`, () => HttpResponse.json(stored(1))),
      http.get(`${BASE}/api/mocks/m-1/history`, () => HttpResponse.json([])),
    )
    await renderApp(<EditMockPage id="m-1" />)
    await userEvent.setup().click(await screen.findByRole('button', { name: 'History' }))
    expect(await screen.findByText('// no earlier versions yet')).toBeTruthy()
  })
})
