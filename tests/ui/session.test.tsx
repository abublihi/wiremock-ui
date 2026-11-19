import { QueryClient } from '@tanstack/react-query'
import userEvent from '@testing-library/user-event'
import { screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { setupServer } from 'msw/node'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { ApiError, SESSION_KEY } from '@/ui/api/client'
import { redirectIfSignedIn, requireSession, safeNext } from '@/ui/auth/session'
import { UserMenu } from '@/ui/components/shell/UserMenu'
import { renderApp, testSession, testUser } from './helpers'

const server = setupServer()
beforeAll(() => server.listen({ onUnhandledFrame: 'error' }))
afterEach(() => server.resetHandlers())
afterAll(() => server.close())

describe('requireSession', () => {
  const location = { pathname: '/mocks', searchStr: '?tag=smoke' }

  it('caches the session and returns it', async () => {
    const queryClient = new QueryClient()
    let calls = 0
    const fetchSession = async () => (calls++, testSession)
    expect(await requireSession(queryClient, location, fetchSession)).toEqual(testSession)
    expect(await requireSession(queryClient, location, fetchSession)).toEqual(testSession)
    expect(calls).toBe(1)
    expect(queryClient.getQueryData(SESSION_KEY)).toEqual(testSession)
  })

  it('redirects to /login with next on 401', async () => {
    const queryClient = new QueryClient()
    const error = await requireSession(queryClient, location, async () => {
      throw new ApiError(401, 'Authentication required')
    }).catch((e: unknown) => e)
    expect(error).toMatchObject({ options: { to: '/login', search: { next: '/mocks?tag=smoke' } } })
    expect(queryClient.getQueryData(SESSION_KEY)).toBeUndefined()
  })

  it('does not hide other failures', async () => {
    await expect(
      requireSession(new QueryClient(), location, async () => {
        throw new ApiError(500, 'Internal error')
      }),
    ).rejects.toMatchObject({ status: 500 })
  })
})

describe('redirectIfSignedIn', () => {
  it('redirects a signed-in user to /mocks', async () => {
    const error = await redirectIfSignedIn(new QueryClient(), async () => testSession).catch((e: unknown) => e)
    expect(error).toMatchObject({ options: { to: '/mocks' } })
  })

  it('lets a signed-out user see the form', async () => {
    await expect(
      redirectIfSignedIn(new QueryClient(), async () => {
        throw new ApiError(401, 'Authentication required')
      }),
    ).resolves.toBeUndefined()
  })
})

describe('safeNext', () => {
  it('keeps same-origin paths and falls back to /mocks otherwise', () => {
    expect(safeNext('/requests?x=1#a')).toBe('/requests?x=1#a')
    for (const bad of ['/login', '/login?next=%2Fmocks', '/login/', '/login#x', undefined, '', 'mocks', 'https://evil.example', '//evil.example', '/\\evil']) expect(safeNext(bad)).toBe('/mocks')
  })
})

async function openMenu() {
  const ue = userEvent.setup()
  await ue.click(await screen.findByRole('button', { name: 'Account menu' }))
  return ue
}

describe('user menu: sign out', () => {
  it('sign out clears the session query and lands on /login', async () => {
    let csrf: string | null = null
    server.use(
      http.delete('http://localhost:3000/api/session', ({ request }) => {
        csrf = request.headers.get('x-csrf-token')
        return new HttpResponse(null, { status: 204 })
      }),
    )
    const { router, queryClient } = await renderApp(<UserMenu user={testUser} />)
    const ue = await openMenu()
    await ue.click(await screen.findByRole('menuitem', { name: 'Sign out' }))

    await screen.findByText(/login page/)
    expect(router.state.location.pathname).toBe('/login')
    expect(csrf).toBe('csrf-1')
    expect(queryClient.getQueryData(SESSION_KEY)).toBeUndefined()
  })
})

describe('user menu: sign out failure', () => {
  it('shows an error toast and stays signed in', async () => {
    server.use(http.delete('http://localhost:3000/api/session', () => HttpResponse.json({ error: 'Internal error' }, { status: 500 })))
    const { router, queryClient } = await renderApp(<UserMenu user={testUser} />)
    const ue = await openMenu()
    await ue.click(await screen.findByRole('menuitem', { name: 'Sign out' }))
    expect(await screen.findByText('Internal error')).toBeTruthy()
    expect(router.state.location.pathname).toBe('/')
    expect(queryClient.getQueryData(SESSION_KEY)).toEqual(testSession)
  })
})

describe('user menu: change password', () => {
  async function openDialog() {
    const ue = await openMenu()
    await ue.click(await screen.findByRole('menuitem', { name: 'Change password' }))
    return { ue, dialog: await screen.findByRole('dialog', { name: 'Change password' }) }
  }

  it('validates 8–72 characters before calling the API', async () => {
    let called = false
    server.use(http.post('http://localhost:3000/api/session/password', () => ((called = true), new HttpResponse(null, { status: 204 }))))
    await renderApp(<UserMenu user={testUser} />)
    const { ue, dialog } = await openDialog()

    await ue.type(within(dialog).getByLabelText('Current password'), 'old-password')
    await ue.type(within(dialog).getByLabelText('New password'), 'short')
    await ue.click(within(dialog).getByRole('button', { name: 'Change password' }))
    expect(await within(dialog).findByText('Use between 8 and 72 characters.')).toBeTruthy()

    await ue.clear(within(dialog).getByLabelText('New password'))
    await ue.type(within(dialog).getByLabelText('New password'), 'x'.repeat(73))
    await ue.click(within(dialog).getByRole('button', { name: 'Change password' }))
    expect(within(dialog).getByText('Use between 8 and 72 characters.')).toBeTruthy()
    expect(called).toBe(false)
  })

  it('counts the upper bound in bytes, like the server', async () => {
    let called = false
    server.use(http.post('http://localhost:3000/api/session/password', () => ((called = true), new HttpResponse(null, { status: 204 }))))
    await renderApp(<UserMenu user={testUser} />)
    const { ue, dialog } = await openDialog()
    await ue.type(within(dialog).getByLabelText('Current password'), 'old-password')
    // 40 two-byte characters: 40 characters but 80 bytes
    await ue.type(within(dialog).getByLabelText('New password'), 'é'.repeat(40))
    await ue.click(within(dialog).getByRole('button', { name: 'Change password' }))
    expect(await within(dialog).findByText('Use between 8 and 72 characters.')).toBeTruthy()
    expect(called).toBe(false)
  })

  it('shows the success toast "Password changed" and closes', async () => {
    let body: unknown
    server.use(
      http.post('http://localhost:3000/api/session/password', async ({ request }) => {
        body = await request.json()
        return new HttpResponse(null, { status: 204 })
      }),
    )
    await renderApp(<UserMenu user={testUser} />)
    const { ue, dialog } = await openDialog()
    await ue.type(within(dialog).getByLabelText('Current password'), 'old-password')
    await ue.type(within(dialog).getByLabelText('New password'), 'new-password-1')
    await ue.click(within(dialog).getByRole('button', { name: 'Change password' }))

    expect(await screen.findByText('Password changed')).toBeTruthy()
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(body).toEqual({ current: 'old-password', next: 'new-password-1' })
  })

  it('shows the server message when the current password is wrong', async () => {
    server.use(
      http.post('http://localhost:3000/api/session/password', () =>
        HttpResponse.json({ error: 'Current password is incorrect' }, { status: 400 }),
      ),
    )
    await renderApp(<UserMenu user={testUser} />)
    const { ue, dialog } = await openDialog()
    await ue.type(within(dialog).getByLabelText('Current password'), 'wrong-password')
    await ue.type(within(dialog).getByLabelText('New password'), 'new-password-1')
    await ue.click(within(dialog).getByRole('button', { name: 'Change password' }))
    expect((await within(dialog).findByRole('alert')).textContent).toBe('Current password is incorrect')
  })
})
