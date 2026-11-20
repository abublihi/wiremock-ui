import userEvent from '@testing-library/user-event'
import { strToU8, zipSync } from 'fflate'
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

  it('confirms a disable of another user, then PATCHes { disabled: true }; enable is immediate', async () => {
    const calls = mockUsers([user(), user({ id: 'u2', username: 'omar' }), user({ id: 'u3', username: 'lina', disabled: true })])
    await renderApp(<UsersPage />)
    const ue = userEvent.setup()
    await screen.findByText('omar')
    await ue.click(screen.getByRole('button', { name: 'Actions for omar' }))
    await ue.click(await screen.findByRole('menuitem', { name: 'Disable' }))
    const dialog = await screen.findByRole('alertdialog', { name: 'Disable omar?' })
    expect(within(dialog).queryByText('This is your own account')).toBeNull()
    expect(calls).toHaveLength(0)
    await ue.click(within(dialog).getByRole('button', { name: 'Disable' }))
    await waitFor(() => expect(calls).toHaveLength(1))
    expect(calls[0]).toMatchObject({ method: 'PATCH', path: '/api/users/u2', body: { disabled: true } })
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
    await screen.findByText('omar disabled')
    await ue.click(screen.getByRole('button', { name: 'Actions for lina' }))
    await ue.click(await screen.findByRole('menuitem', { name: 'Enable' }))
    await waitFor(() => expect(calls).toHaveLength(2))
    expect(calls[1]).toMatchObject({ path: '/api/users/u3', body: { disabled: false } })
  })

  it('warns before you disable or delete yourself, and cancelling sends nothing', async () => {
    const calls = mockUsers([user(), user({ id: 'u2', username: 'omar' })])
    await renderApp(<UsersPage />)
    const ue = userEvent.setup()
    await screen.findByText('omar')
    await ue.click(screen.getByRole('button', { name: 'Actions for sara' }))
    await ue.click(await screen.findByRole('menuitem', { name: 'Disable' }))
    let dialog = await screen.findByRole('alertdialog', { name: 'Disable sara?' })
    within(dialog).getByText('This is your own account')
    within(dialog).getByText("You will be signed out and can't sign back in until another user re-enables you.")
    await ue.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())

    await ue.click(screen.getByRole('button', { name: 'Actions for sara' }))
    await ue.click(await screen.findByRole('menuitem', { name: 'Delete' }))
    dialog = await screen.findByRole('alertdialog', { name: 'Delete sara?' })
    within(dialog).getByText("You will be signed out and can't sign back in until another user adds you again.")
    await ue.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    expect(calls).toHaveLength(0)

    await ue.click(screen.getByRole('button', { name: 'Actions for omar' }))
    await ue.click(await screen.findByRole('menuitem', { name: 'Delete' }))
    dialog = await screen.findByRole('alertdialog', { name: 'Delete omar?' })
    expect(within(dialog).queryByText('This is your own account')).toBeNull()
  })

  it('shows the last-active-user 409 verbatim when disabling', async () => {
    mockUsers([user()], { patch: () => HttpResponse.json({ error: 'At least one active user is required' }, { status: 409 }) })
    await renderApp(<UsersPage />)
    const ue = userEvent.setup()
    await screen.findByText('sara')
    await ue.click(screen.getByRole('button', { name: 'Actions for sara' }))
    await ue.click(await screen.findByRole('menuitem', { name: 'Disable' }))
    const dialog = await screen.findByRole('alertdialog')
    await ue.click(within(dialog).getByRole('button', { name: 'Disable' }))
    await within(dialog).findByText('At least one active user is required')
    within(dialog).getByText('Could not update the user')
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
    within(dialog).getByText('Could not delete the user')
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

  it('lists each problem file with its error and blocks the import until it is removed', async () => {
    const calls = mockImport()
    await renderApp(<ImportPage />)
    const ue = userEvent.setup({ applyAccept: false })
    const big = file('{}', 'big.json')
    Object.defineProperty(big, 'size', { value: 10 * 1024 * 1024 + 1 })
    await ue.upload(screen.getByLabelText('Choose files'), [file('x', 'notes.txt'), big, file('{nope', 'bad.json'), file('{"hello":1}', 'odd.json'), file(bundle, 'good.json')])
    const list = await screen.findByRole('list', { name: 'Files' })
    expect(within(list).getByText('notes.txt is not a .json or .zip file.')).toBeTruthy()
    expect(within(list).getByText(/big\.json is 10\.0 MB\. The limit is 10 MB\./)).toBeTruthy()
    expect(within(list).getByText(/bad\.json is not valid JSON/)).toBeTruthy()
    expect(within(list).getByText(/odd\.json: unrecognised bundle shape/)).toBeTruthy()
    expect(within(list).getByText('1 integration · 2 endpoints · 3 mocks')).toBeTruthy()
    expect(screen.getByText('Remove the files marked with an error (or fix them and choose again) to import the rest.')).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Import' }) as HTMLButtonElement).disabled).toBe(true)
    for (const name of ['notes.txt', 'big.json', 'bad.json', 'odd.json']) await ue.click(screen.getByRole('button', { name: `Remove ${name}` }))
    expect((screen.getByRole('button', { name: 'Import' }) as HTMLButtonElement).disabled).toBe(false)
    expect(calls).toHaveLength(0)
  })

  it('shows the local summary, then posts without prune and renders the report', async () => {
    const calls = mockImport()
    await renderApp(<ImportPage />)
    const ue = userEvent.setup({ applyAccept: false })
    await ue.upload(screen.getByLabelText('Choose files'), file(bundle))
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

  it('merges several files and a zip in path order into one request', async () => {
    const calls = mockImport()
    await renderApp(<ImportPage />)
    const ue = userEvent.setup({ applyAccept: false })
    const stub = (path: string) => ({ request: { method: 'GET', urlPath: path }, response: { status: 200 } })
    const zip = zipSync({ 'mappings/z1.json': strToU8(JSON.stringify(stub('/z1'))), '../evil.json': strToU8(JSON.stringify(stub('/evil'))) })
    await ue.upload(screen.getByLabelText('Choose files'), [
      file(JSON.stringify(stub('/b')), 'b.json'),
      new File([zip], 'more.zip', { type: 'application/zip' }),
      file(JSON.stringify({ mappings: [stub('/a1'), stub('/a2')] }), 'a.json'),
    ])
    const summary = await screen.findByRole('region', { name: /In 3 files/ })
    expect(within(summary).getByText('Mocks').nextSibling?.textContent).toBe('4')
    expect(within(summary).getByText('more.zip/mappings/z1.json')).toBeTruthy()
    expect(within(summary).getByText(/Skipped 1 zip entry outside the archive: more\.zip\/\.\.\/evil\.json/)).toBeTruthy()
    await ue.click(screen.getByRole('button', { name: 'Import' }))
    await screen.findByText('Import finished')
    const sent = calls[0]!.body as { mocks: { request: { urlPath: string } }[] }
    expect(sent.mocks.map((m) => m.request.urlPath)).toEqual(['/a1', '/a2', '/b', '/z1'])
  })

  it('two files with the same name are listed and removed separately', async () => {
    mockImport()
    await renderApp(<ImportPage />)
    const ue = userEvent.setup({ applyAccept: false })
    await ue.upload(screen.getByLabelText('Choose files'), [file(bundle, 'same.json'), file(JSON.stringify({ mappings: [{}] }), 'same.json')])
    const list = await screen.findByRole('list', { name: 'Files' })
    expect(within(list).getAllByRole('listitem')).toHaveLength(2)
    await ue.click(screen.getByRole('button', { name: 'Remove same.json (2)' }))
    expect(within(list).getAllByRole('listitem')).toHaveLength(1)
    expect(within(list).getByText('same.json')).toBeTruthy()
  })

  it('reads a chosen folder: .json files only, hidden ones skipped', async () => {
    const calls = mockImport()
    await renderApp(<ImportPage />)
    const ue = userEvent.setup({ applyAccept: false })
    const inFolder = (content: string, path: string) => {
      const f = file(content, path.split('/').pop())
      Object.defineProperty(f, 'webkitRelativePath', { value: path })
      return f
    }
    const stub = JSON.stringify({ request: { method: 'GET', urlPath: '/f' }, response: { status: 200 } })
    await ue.upload(screen.getByLabelText('Choose folder'), [
      inFolder(stub, 'mocks/sub/two.json'),
      inFolder(stub, 'mocks/one.json'),
      inFolder('junk', 'mocks/readme.md'),
      inFolder('junk', 'mocks/.hidden.json'),
      inFolder('junk', 'mocks/.git/x.json'),
    ])
    const list = await screen.findByRole('list', { name: 'Files' })
    expect(within(list).getAllByRole('listitem').map((li) => li.querySelector('[data-path]')?.textContent)).toEqual(['mocks/one.json', 'mocks/sub/two.json'])
    await ue.click(screen.getByRole('button', { name: 'Import' }))
    await screen.findByText('Import finished')
    expect((calls[0]!.body as { mocks: unknown[] }).mocks).toHaveLength(2)
  })

  it('says when the merged files are over the 10 MB limit', async () => {
    mockImport()
    await renderApp(<ImportPage />)
    const ue = userEvent.setup({ applyAccept: false })
    const pad = 'x'.repeat(6 * 1024 * 1024)
    const big = (n: number) => file(JSON.stringify({ request: { method: 'GET', urlPath: '/p' }, response: { status: 200, body: pad } }), `p${n}.json`)
    await ue.upload(screen.getByLabelText('Choose files'), [big(1), big(2)])
    await screen.findByText(/Together these files are 12\.0 MB; one import can be at most 10 MB\. Split them into smaller imports\./)
    expect((screen.getByRole('button', { name: 'Import' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('sends ?prune=true only when the box is checked, and summarises a WireMock export', async () => {
    const calls = mockImport()
    await renderApp(<ImportPage />)
    const ue = userEvent.setup({ applyAccept: false })
    await ue.upload(screen.getByLabelText('Choose files'), file(JSON.stringify({ mappings: [{}, {}] }), 'export.json'))
    const summary = await screen.findByRole('region', { name: /In export\.json/ })
    expect(within(summary).getByText('Mocks').nextSibling?.textContent).toBe('2')
    await ue.click(screen.getByRole('checkbox', { name: "Remove baseline mocks that aren't in this import" }))
    await ue.click(screen.getByRole('button', { name: 'Import' }))
    await screen.findByText('Import finished')
    expect(calls[0]!.search).toBe('?prune=true')
  })

  it('shows a server refusal and keeps the files', async () => {
    server.use(http.post(`${BASE}/api/import`, () => HttpResponse.json({ error: 'catalog[0]: integration "zz" does not exist' }, { status: 400 })))
    await renderApp(<ImportPage />)
    const ue = userEvent.setup({ applyAccept: false })
    await ue.upload(screen.getByLabelText('Choose files'), file(bundle))
    await ue.click(await screen.findByRole('button', { name: 'Import' }))
    await screen.findByText('catalog[0]: integration "zz" does not exist')
    expect(screen.getByRole('button', { name: 'Import' })).toBeTruthy()
  })

  it('offers an export of everything as a bundle or WireMock mappings', async () => {
    await renderApp(<ImportPage />)
    const ue = userEvent.setup()
    await ue.click(screen.getByRole('button', { name: 'Export' }))
    expect(screen.getByRole('menuitem', { name: /Bundle \(\.json\)/ }).getAttribute('href')).toBe('/api/export?scope=all&format=bundle')
    expect(screen.getByRole('menuitem', { name: /WireMock mappings \(\.zip\)/ }).getAttribute('href')).toBe('/api/export?scope=all&format=mappings')
  })
})
