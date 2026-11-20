import { useState, type FormEvent } from 'react'
import { createFileRoute, useRouter } from '@tanstack/react-router'
import { ApiError } from '@/ui/api/client'
import { useLogin } from '@/ui/api/queries'
import { redirectIfSignedIn, safeNext } from '@/ui/auth/session'
import { HazardStrip } from '@/ui/components/shell/HazardStrip'
import { Brand } from '@/ui/components/shell/Brand'
import { Alert, AlertDescription } from '@/ui/components/ui/alert'
import { Button } from '@/ui/components/ui/button'
import { Field, FieldGroup, FieldLabel } from '@/ui/components/ui/field'
import { Input } from '@/ui/components/ui/input'
import { Spinner } from '@/ui/components/ui/spinner'
import { useT, type MessageKey } from '@/ui/i18n'

export const Route = createFileRoute('/login')({
  validateSearch: (search: Record<string, unknown>): { next?: string } =>
    typeof search.next === 'string' ? { next: search.next } : {},
  beforeLoad: ({ context }) => redirectIfSignedIn(context.queryClient),
  component: () => <LoginPage next={Route.useSearch().next} />,
})

function errorKey(error: Error): MessageKey | null {
  if (error instanceof ApiError) {
    if (error.status === 401) return 'login.wrongCredentials'
    if (error.status === 429) return 'login.rateLimited'
  }
  return null
}

export function LoginPage({ next }: { next?: string }) {
  const t = useT()
  const router = useRouter()
  const login = useLogin()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')

  function submit(event: FormEvent) {
    event.preventDefault()
    login.mutate(
      { username: username.trim(), password },
      { onSuccess: () => router.history.push(safeNext(next)) },
    )
  }

  const key = login.error ? errorKey(login.error) : null
  return (
    <div className="flex min-h-svh flex-col bg-background">
      <HazardStrip />
      <main className="dot-grid relative isolate flex flex-1 items-center justify-center overflow-hidden px-4 py-10">
        {/* Backdrop: a faint grid fading out from the centre and two soft signal glows. */}
        <div aria-hidden className="grid-lines pointer-events-none absolute inset-0 -z-10" />
        <div aria-hidden className="pointer-events-none absolute -top-32 -start-32 -z-10 size-96 rounded-full bg-signal/10 blur-[110px]" />
        <div aria-hidden className="pointer-events-none absolute top-1/2 start-1/2 -z-10 size-[30rem] -translate-x-1/2 -translate-y-1/2 rounded-full bg-signal/6 blur-[120px]" />
        <div aria-hidden className="pointer-events-none absolute -end-24 -bottom-24 -z-10 size-[28rem] rounded-full bg-signal/6 blur-[130px]" />

        <div className="fade-up flex w-full max-w-sm flex-col gap-8">
          <Brand caption size="lg" />
          <form onSubmit={submit} className="glass-panel flex flex-col gap-6 rounded-xl p-6">
            <div className="flex flex-col gap-1.5">
              <p className="mb-1 text-[10px] tracking-[0.2em] text-signal-fg uppercase">
                <span aria-hidden>── </span>
                {t('login.eyebrow')}
              </p>
              <h1 className="font-display text-2xl leading-none font-bold tracking-wide uppercase">{t('login.title')}</h1>
              <p className="text-xs text-muted-foreground">{t('login.subtitle')}</p>
            </div>
            <p aria-hidden className="-mt-1 border-b border-line/60 pb-4 text-[11px] text-muted-foreground">
              <span className="text-signal-fg">$</span> wiremock-ui login --interactive
            </p>
            <FieldGroup className="gap-4">
              {login.error && (
                <Alert variant="destructive">
                  <AlertDescription>{key ? t(key) : login.error.message || t('error.generic')}</AlertDescription>
                </Alert>
              )}
              <Field>
                <FieldLabel htmlFor="username">{t('login.username')}</FieldLabel>
                <Input
                  id="username"
                  name="username"
                  autoComplete="username"
                  autoCapitalize="none"
                  spellCheck={false}
                  required
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="password">{t('login.password')}</FieldLabel>
                <Input
                  id="password"
                  name="password"
                  type="password"
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </Field>
            </FieldGroup>
            <Button type="submit" size="lg" disabled={login.isPending}>
              {login.isPending && <Spinner data-icon="inline-start" />}
              {login.isPending ? t('login.submitting') : t('login.submit')}
            </Button>
          </form>
        </div>
      </main>
    </div>
  )
}
