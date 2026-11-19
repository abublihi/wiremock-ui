import userEvent from '@testing-library/user-event'
import { screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { setupServer } from 'msw/node'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { LoginPage } from '@/routes/login'
import { SESSION_KEY } from '@/ui/api/client'
import { renderApp, testSession } from './helpers'

const server = setupServer()
beforeAll(() => server.listen({ onUnhandledFrame: 'error' }))
afterEach(() => server.resetHandlers())
afterAll(() => server.close())

const signIn = http.post('http://localhost:3000/api/session', async ({ request }) => {
  const body = (await request.json()) as { username: string; password: string }
  if (body.password !== 'correct-horse') return HttpResponse.json({ error: 'Invalid username or password' }, { status: 401 })
  return HttpResponse.json(testSession)
})

async function fillAndSubmit(password = 'correct-horse') {
  const ue = userEvent.setup()
  await ue.type(screen.getByLabelText('Username'), 'sara')
  await ue.type(screen.getByLabelText('Password'), password)
  await ue.click(screen.getByRole('button', { name: 'Sign in' }))
}

describe('login page', () => {
  it('login success navigates to next', async () => {
    server.use(signIn)
    const { router, queryClient } = await renderApp(<LoginPage next="/requests?x=1" />, { session: null })
    await fillAndSubmit()
    await screen.findByText('requests page')
    expect(router.state.location.pathname).toBe('/requests')
    expect(queryClient.getQueryData(SESSION_KEY)).toEqual(testSession)
  })

  it.each(['https://evil.example/steal', '//evil.example', '/\\evil.example', 'javascript:alert(1)'])(
    'rejects an absolute next URL (open redirect): %s',
    async (next) => {
      server.use(signIn)
      const { router } = await renderApp(<LoginPage next={next} />, { session: null })
      await fillAndSubmit()
      await screen.findByText('mocks page')
      expect(router.state.location.pathname).toBe('/mocks')
    },
  )

  it('never sends the user back to /login', async () => {
    server.use(signIn)
    const { router } = await renderApp(<LoginPage next="/login?next=%2Fmocks" />, { session: null })
    await fillAndSubmit()
    await screen.findByText('mocks page')
    expect(router.state.location.pathname).toBe('/mocks')
  })

  it("signing in as another user leaves nothing cached from the previous one", async () => {
    server.use(signIn)
    const { queryClient } = await renderApp(<LoginPage />, { session: null })
    queryClient.setQueryData(['mocks'], [{ id: 'user-a-mock' }])
    await fillAndSubmit()
    await screen.findByText('mocks page')
    expect(queryClient.getQueryData(['mocks'])).toBeUndefined()
    expect(queryClient.getQueryData(SESSION_KEY)).toEqual(testSession)
  })

  it('goes to /mocks when there is no next', async () => {
    server.use(signIn)
    await renderApp(<LoginPage />, { session: null })
    await fillAndSubmit()
    await screen.findByText('mocks page')
  })

  it('login 401 shows "Wrong username or password"', async () => {
    server.use(signIn)
    await renderApp(<LoginPage />, { session: null })
    await fillAndSubmit('bad')
    expect((await screen.findByRole('alert')).textContent).toBe('Wrong username or password')
    expect(screen.queryByText('mocks page')).toBeNull()
  })

  it('429 shows the rate-limit message', async () => {
    server.use(
      http.post('http://localhost:3000/api/session', () =>
        HttpResponse.json({ error: 'Too many login attempts; try again later' }, { status: 429 }),
      ),
    )
    await renderApp(<LoginPage />, { session: null })
    await fillAndSubmit()
    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toBe(
        'Too many sign-in attempts from this network. Try again in 15 minutes.',
      ),
    )
  })

  it('disables the button while signing in', async () => {
    let release = () => {}
    server.use(
      http.post('http://localhost:3000/api/session', async () => {
        await new Promise<void>((resolve) => (release = resolve))
        return HttpResponse.json(testSession)
      }),
    )
    await renderApp(<LoginPage />, { session: null })
    await fillAndSubmit()
    const button = await screen.findByRole('button', { name: /Signing in…/ })
    expect(button).toHaveProperty('disabled', true)
    release()
    await screen.findByText('mocks page')
  })
})
