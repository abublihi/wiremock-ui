import { useState, type FormEvent } from 'react'
import { createFileRoute, useRouter } from '@tanstack/react-router'
import { ApiError } from '@/ui/api/client'
import { useLogin } from '@/ui/api/queries'
import { redirectIfSignedIn, safeNext } from '@/ui/auth/session'
import { HazardStrip } from '@/ui/components/shell/HazardStrip'
import { Brand } from '@/ui/components/shell/TopBar'
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
      <main className="flex flex-1 items-center justify-center p-4">
        <form
          onSubmit={submit}
          className="flex w-full max-w-sm flex-col gap-6 rounded-xl border bg-surface p-6"
        >
          <div className="flex flex-col gap-2">
            <Brand />
            <h1 className="font-condensed text-2xl font-semibold">{t('login.title')}</h1>
            <p className="text-sm text-muted-foreground">{t('login.subtitle')}</p>
          </div>
          <FieldGroup>
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
          <Button type="submit" disabled={login.isPending}>
            {login.isPending && <Spinner data-icon="inline-start" />}
            {login.isPending ? t('login.submitting') : t('login.submit')}
          </Button>
        </form>
      </main>
    </div>
  )
}
