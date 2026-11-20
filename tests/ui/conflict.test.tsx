import userEvent from '@testing-library/user-event'
import { screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { setupServer } from 'msw/node'
import { toast } from 'sonner'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { EditMockPage } from '@/ui/components/editor/EditMockPage'
import { BASE, jsonText, mockCatalog, setJson, stored } from './editor-fixtures'
import { renderApp } from './helpers'

const server = setupServer()
beforeAll(() => server.listen({ onUnhandledFrame: 'error' }))
afterEach(() => {
  server.resetHandlers()
  toast.dismiss()
})
afterAll(() => server.close())

// A mock only Advanced mode can show, so the editor opens on the JSON.
const advancedStub = (version: number, trace: string) =>
  stored(version, { request: { ...stored().request, headers: { 'X-Trace': { equalTo: trace } } } })

const MINE = '{"request": {"method": "GET", "urlPath": "/mine"}, "response": {"status": 200}}'

/** Serves version 3, answers every PUT with 409, and serves version 4 once `theirs()` is called. */
function conflictServer() {
  let current = advancedStub(3, 'first')
  mockCatalog(server)
  server.use(
    http.get(`${BASE}/api/mocks/m-1`, () => HttpResponse.json(current)),
    http.put(`${BASE}/api/mocks/m-1`, () => HttpResponse.json({ error: 'This mock was changed by someone else' }, { status: 409 })),
  )
  return { theirs: () => void (current = advancedStub(4, 'theirs')) }
}

async function saveIntoConflict() {
  await renderApp(<EditMockPage id="m-1" />)
  await screen.findByRole('tab', { name: 'Advanced', selected: true })
  setJson(MINE)
  const ue = userEvent.setup()
  await ue.click(screen.getByRole('button', { name: 'Save mock' }))
  const alert = await screen.findByRole('alert')
  expect(alert.textContent).toContain('Someone changed this mock since you opened it. Reload to see their version.')
  return { ue, alert }
}

describe('save conflict', () => {
  it('keeps the draft in the editor', async () => {
    conflictServer()
    await saveIntoConflict()
    expect(jsonText()).toBe(MINE)
    expect(screen.queryByText('Mock saved')).toBeNull()
  })

  it('Reload asks before discarding the draft; Keep editing keeps it', async () => {
    const { theirs } = conflictServer()
    const { ue, alert } = await saveIntoConflict()
    theirs()
    await ue.click(within(alert).getByRole('button', { name: 'Reload' }))
    const dialog = await screen.findByRole('alertdialog', { name: 'Discard your changes?' })
    await ue.click(within(dialog).getByRole('button', { name: 'Keep editing' }))
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
    expect(jsonText()).toBe(MINE)
    expect(screen.getByRole('alert').textContent).toContain('Someone changed this mock')
  })

  it('Reload, once confirmed, loads their version', async () => {
    const { theirs } = conflictServer()
    const { ue, alert } = await saveIntoConflict()
    theirs()
    await ue.click(within(alert).getByRole('button', { name: 'Reload' }))
    await ue.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Discard and reload' }))
    await waitFor(() => expect(jsonText()).toContain('"theirs"'))
    expect(within(screen.getByRole('region', { name: 'Server fields' })).getByText('4')).toBeTruthy()
    expect(screen.queryByText(/Someone changed this mock/)).toBeNull()
  })

  it('Copy my JSON puts the draft on the clipboard', async () => {
    conflictServer()
    const { ue, alert } = await saveIntoConflict()
    const writeText = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue()
    await ue.click(within(alert).getByRole('button', { name: 'Copy my JSON' }))
    expect(writeText).toHaveBeenCalledWith(MINE)
    expect(await screen.findByText('Your JSON is on the clipboard')).toBeTruthy()
    expect(jsonText()).toBe(MINE)
  })

  it('a conflict in Simple mode offers the same choices', async () => {
    mockCatalog(server)
    server.use(
      http.get(`${BASE}/api/mocks/m-1`, () => HttpResponse.json(stored())),
      http.put(`${BASE}/api/mocks/m-1`, () => HttpResponse.json({ error: 'changed' }, { status: 409 })),
    )
    await renderApp(<EditMockPage id="m-1" />)
    const ue = userEvent.setup()
    const key = (await screen.findByLabelText('Value of $.idNo in the request body')) as HTMLInputElement
    await ue.type(key, '9')
    await ue.click(screen.getByRole('button', { name: 'Save mock' }))
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('Someone changed this mock since you opened it.')
    expect(within(alert).getByRole('button', { name: 'Reload' })).toBeTruthy()
    expect(key.value).toBe('429')
  })
})
