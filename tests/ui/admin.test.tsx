import userEvent from '@testing-library/user-event'
import { screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { setupServer } from 'msw/node'
import { toast } from 'sonner'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import type { AuditEntry } from '@/server/audit/log'
import type { ImportReport } from '@/server/bundle/importer'
import type { PublicUser } from '@/server/users/types'
import { AuditPage } from '@/routes/_app/audit'
import { ImportPage } from '@/routes/_app/import'
import { UsersPage } from '@/routes/_app/users'
import { renderApp } from './helpers'

const server = setupServer()
beforeAll(() => server.listen({ onUnhandledFrame: 'error' }))
afterEach(() => {
  server.resetHandlers()
  toast.dismiss()
})
afterAll(() => server.close())

const BASE = 'http://localhost:3000'
type Call = { method: string; path: string; search: string; body?: unknown }

async function record(request: Request, calls: Call[]) {
  const text = await request.text()
  const url = new URL(request.url)
  calls.push({ method: request.method, path: url.pathname, search: url.search, body: text ? JSON.parse(text) : undefined })
}

const user = (over: Partial<PublicUser> = {}): PublicUser => ({
  id: 'u1', username: 'sara', displayName: 'Sara Q', disabled: false,
  createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', ...over,
})

describe('users page', () => {
  function mockUsers(users: PublicUser[], handlers: { post?: () => Response; patch?: () => Response; del?: () => Response } = {}) {
    const calls: Call[] = []
    server.use(
      http.get(`${BASE}/api/users`, () => HttpResponse.json(users)),
      http.post(`${BASE}/api/users`, async ({ request }) => {
        await record(request, calls)
        return handlers.post?.() ?? HttpResponse.json(user({ id: 'u9', username: 'omar' }), { status: 201 })
      }),
      http.patch(`${BASE}/api/users/:id`, async ({ request }) => {
        await record(request, calls)
        return handlers.patch?.() ?? HttpResponse.json(user())
      }),
      http.delete(`${BASE}/api/users/:id`, async ({ request }) => {
        await record(request, calls)
        return handlers.del?.() ?? new HttpResponse(null, { status: 204 })
      }),
    )
    return calls
  }

  it('lists username, display name, status and created, with no role column', async () => {
    mockUsers([user(), user({ id: 'u2', username: 'omar', displayName: 'Omar', disabled: true })])
    await renderApp(<UsersPage />)
    await screen.findByText('omar')
    expect(screen.getByText('// 2 users')).toBeTruthy()
    expect(screen.getByText('Active')).toBeTruthy()
    expect(screen.getByText('Disabled')).toBeTruthy()
    expect(screen.queryByText(/role/i)).toBeNull()
  })

  it('adds a user: posts username, displayName and password, never a role', async () => {
    const calls = mockUsers([user()])
    await renderApp(<UsersPage />)
    const ue = userEvent.setup()
    await screen.findByText('sara')
    await ue.click(screen.getByRole('button', { name: 'Add user' }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('8–72 characters.')).toBeTruthy()
    expect(within(dialog).getByText(/2–32 characters: a-z/)).toBeTruthy()
    await ue.type(within(dialog).getByLabelText('Username'), 'Omar')
    await ue.type(within(dialog).getByLabelText('Display name'), 'Omar K')
    await ue.type(within(dialog).getByLabelText('Initial password'), 'correct-horse')
    await ue.click(within(dialog).getByRole('button', { name: 'Add user' }))
    await waitFor(() => expect(calls).toHaveLength(1))
    expect(calls[0]).toMatchObject({ method: 'POST', path: '/api/users', body: { username: 'Omar', displayName: 'Omar K', password: 'correct-horse' } })
    expect(Object.keys(calls[0]!.body as object)).not.toContain('role')
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  it('shows a 400 on the field it names and a 409 on the username', async () => {
    mockUsers([user()], { post: () => HttpResponse.json({ error: 'password must be 8–72 characters' }, { status: 400 }) })
    await renderApp(<UsersPage />)
    const ue = userEvent.setup()
    await screen.findByText('sara')
    await ue.click(screen.getByRole('button', { name: 'Add user' }))
    const dialog = await screen.findByRole('dialog')
    await ue.type(within(dialog).getByLabelText('Username'), 'omar')
    await ue.type(within(dialog).getByLabelText('Initial password'), 'short')
    await ue.click(within(dialog).getByRole('button', { name: 'Add user' }))
    const error = await within(dialog).findByText('password must be 8–72 characters')
    expect(within(dialog).getByLabelText('Initial password').getAttribute('aria-invalid')).toBe('true')
    expect(error.id).toBeTruthy()

    server.use(http.post(`${BASE}/api/users`, () => HttpResponse.json({ error: 'Username already exists' }, { status: 409 })))
    await ue.click(within(dialog).getByRole('button', { name: 'Add user' }))
    await within(dialog).findByText('Username already exists')
    expect(within(dialog).getByLabelText('Username').getAttribute('aria-invalid')).toBe('true')
  })

  it('disables and enables with PATCH { disabled }', async () => {
    const calls = mockUsers([user(), user({ id: 'u2', username: 'omar', disabled: true })])
    await renderApp(<UsersPage />)
    const ue = userEvent.setup()
    await screen.findByText('omar')
    await ue.click(screen.getByRole('button', { name: 'Actions for sara' }))
    await ue.click(await screen.findByRole('menuitem', { name: 'Disable' }))
    await waitFor(() => expect(calls).toHaveLength(1))
    expect(calls[0]).toMatchObject({ method: 'PATCH', path: '/api/users/u1', body: { disabled: true } })
    await ue.click(screen.getByRole('button', { name: 'Actions for omar' }))
    await ue.click(await screen.findByRole('menuitem', { name: 'Enable' }))
    await waitFor(() => expect(calls).toHaveLength(2))
    expect(calls[1]).toMatchObject({ path: '/api/users/u2', body: { disabled: false } })
  })

  it('shows the last-active-user 409 verbatim when disabling', async () => {
    mockUsers([user()], { patch: () => HttpResponse.json({ error: 'At least one active user is required' }, { status: 409 }) })
    await renderApp(<UsersPage />)
    const ue = userEvent.setup()
    await screen.findByText('sara')
    await ue.click(screen.getByRole('button', { name: 'Actions for sara' }))
    await ue.click(await screen.findByRole('menuitem', { name: 'Disable' }))
    await screen.findByText('At least one active user is required')
  })

  it('resets a password with PATCH { password } only', async () => {
    const calls = mockUsers([user()])
    await renderApp(<UsersPage />)
    const ue = userEvent.setup()
    await screen.findByText('sara')
    await ue.click(screen.getByRole('button', { name: 'Actions for sara' }))
    await ue.click(await screen.findByRole('menuitem', { name: 'Reset password' }))
    const dialog = await screen.findByRole('dialog')
    await ue.type(within(dialog).getByLabelText('New password'), 'brand-new-pass')
    await ue.click(within(dialog).getByRole('button', { name: 'Reset password' }))
    await waitFor(() => expect(calls).toHaveLength(1))
    expect(calls[0]).toMatchObject({ method: 'PATCH', path: '/api/users/u1', body: { password: 'brand-new-pass' } })
    expect(calls[0]!.body).toEqual({ password: 'brand-new-pass' })
  })

  it('confirms before deleting and keeps a 409 in the dialog verbatim', async () => {
    const calls = mockUsers([user()], { del: () => HttpResponse.json({ error: 'At least one active user is required' }, { status: 409 }) })
    await renderApp(<UsersPage />)
    const ue = userEvent.setup()
    await screen.findByText('sara')
    await ue.click(screen.getByRole('button', { name: 'Actions for sara' }))
    await ue.click(await screen.findByRole('menuitem', { name: 'Delete' }))
    const dialog = await screen.findByRole('alertdialog')
    expect(calls).toHaveLength(0)
    await ue.click(within(dialog).getByRole('button', { name: 'Delete' }))
    await within(dialog).findByText('At least one active user is required')
    expect(calls[0]).toMatchObject({ method: 'DELETE', path: '/api/users/u1' })
    expect(screen.getByRole('alertdialog')).toBeTruthy()
  })
})

describe('audit page', () => {
  const entry = (n: number): AuditEntry => ({ at: `2026-01-01T00:00:${String(n).padStart(2, '0')}.000Z`, actor: 'sara', action: `mock.create${n}`, target: `t${n}`, details: { n } })

  it('pages with the cursor and appends', async () => {
    const seen: (string | null)[] = []
    server.use(
      http.get(`${BASE}/api/audit`, ({ request }) => {
        const url = new URL(request.url)
        const cursor = url.searchParams.get('cursor')
        seen.push(cursor)
        return cursor
          ? HttpResponse.json({ entries: [entry(3)], nextCursor: null })
          : HttpResponse.json({ entries: [entry(1), entry(2)], nextCursor: 'cur-2' })
      }),
    )
    await renderApp(<AuditPage />)
    const ue = userEvent.setup()
    await screen.findByText('mock.create1')
    expect(screen.getByText('{"n":1}')).toBeTruthy()
    await ue.click(screen.getByRole('button', { name: 'Load more' }))
    await screen.findByText('mock.create3')
    expect(seen).toEqual([null, 'cur-2'])
    expect(screen.getByText('mock.create1')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Load more' })).toBeNull()
  })
})

describe('import page', () => {
  const report: ImportReport = { integrations: 1, endpoints: 2, created: 3, updated: 1, unchanged: 4, skipped: [{ id: 'bad-1', reason: 'invalid stub' }], pruned: 2, ignoredOidcIdentities: 1 }
  function mockImport() {
    const calls: Call[] = []
    server.use(
      http.post(`${BASE}/api/import`, async ({ request }) => {
        await record(request, calls)
        return HttpResponse.json(report)
      }),
    )
    return calls
  }
  const file = (content: string, name = 'bundle.json') => new File([content], name, { type: 'application/json' })
  const bundle = JSON.stringify({ integrations: [{ key: 'a' }], catalog: [{ key: 'x' }, { key: 'y' }], mocks: [{}, {}, {}], oidcIdentities: [{}] })

  it('rejects a non-JSON file and an oversize file before upload', async () => {
    const calls = mockImport()
    await renderApp(<ImportPage />)
    const ue = userEvent.setup({ applyAccept: false })
    const input = screen.getByLabelText('Choose file')
    await ue.upload(input, file('x', 'notes.txt'))
    await screen.findByText('notes.txt is not a .json file.')
    const big = file('{}', 'big.json')
    Object.defineProperty(big, 'size', { value: 10 * 1024 * 1024 + 1 })
    await ue.upload(input, big)
    await screen.findByText(/big\.json is 10\.0 MB\. The limit is 10 MB\./)
    await ue.upload(input, file('{nope', 'bad.json'))
    await screen.findByText(/bad\.json is not valid JSON/)
    await ue.upload(input, file('{"hello":1}', 'odd.json'))
    await screen.findByText(/odd\.json is not a bundle/)
    expect(screen.queryByRole('button', { name: 'Import' })).toBeNull()
    expect(calls).toHaveLength(0)
  })

  it('shows the local summary, then posts without prune and renders the report', async () => {
    const calls = mockImport()
    await renderApp(<ImportPage />)
    const ue = userEvent.setup({ applyAccept: false })
    await ue.upload(screen.getByLabelText('Choose file'), file(bundle))
    const summary = await screen.findByRole('region', { name: /In bundle\.json/ })
    expect(within(summary).getByText('Integrations').nextSibling?.textContent).toBe('1')
    expect(within(summary).getByText('Endpoints').nextSibling?.textContent).toBe('2')
    expect(within(summary).getByText('Mocks').nextSibling?.textContent).toBe('3')
    expect(calls).toHaveLength(0)
    await ue.click(screen.getByRole('button', { name: 'Import' }))
    await screen.findByText('Import finished')
    expect(calls[0]).toMatchObject({ method: 'POST', path: '/api/import', search: '' })
    expect((calls[0]!.body as { mocks: unknown[] }).mocks).toHaveLength(3)
    expect(screen.getByText('Skipped (1)')).toBeTruthy()
    expect(screen.getByText('bad-1')).toBeTruthy()
    expect(screen.getByText('invalid stub')).toBeTruthy()
    expect(screen.getByText('Pruned').nextSibling?.textContent).toBe('2')
    expect(screen.getByText('Ignored OIDC identities').nextSibling?.textContent).toBe('1')
  })

  it('sends ?prune=true only when the box is checked, and summarises a WireMock export', async () => {
    const calls = mockImport()
    await renderApp(<ImportPage />)
    const ue = userEvent.setup({ applyAccept: false })
    await ue.upload(screen.getByLabelText('Choose file'), file(JSON.stringify({ mappings: [{}, {}] }), 'export.json'))
    const summary = await screen.findByRole('region', { name: /In export\.json/ })
    expect(within(summary).getByText('Mocks').nextSibling?.textContent).toBe('2')
    await ue.click(screen.getByRole('checkbox', { name: "Remove baseline mocks that aren't in this file" }))
    await ue.click(screen.getByRole('button', { name: 'Import' }))
    await screen.findByText('Import finished')
    expect(calls[0]!.search).toBe('?prune=true')
  })

  it('shows a server refusal and keeps the file', async () => {
    server.use(http.post(`${BASE}/api/import`, () => HttpResponse.json({ error: 'catalog[0]: integration "zz" does not exist' }, { status: 400 })))
    await renderApp(<ImportPage />)
    const ue = userEvent.setup({ applyAccept: false })
    await ue.upload(screen.getByLabelText('Choose file'), file(bundle))
    await ue.click(await screen.findByRole('button', { name: 'Import' }))
    await screen.findByText('catalog[0]: integration "zz" does not exist')
    expect(screen.getByRole('button', { name: 'Import' })).toBeTruthy()
  })
})
