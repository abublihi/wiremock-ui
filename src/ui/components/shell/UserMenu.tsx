import { useState, type FormEvent } from 'react'
import { KeyRoundIcon, LogOutIcon } from 'lucide-react'
import { toast } from 'sonner'
import type { PublicUser } from '@/server/users/types'
import { useChangePassword, useLogout } from '@/ui/api/queries'
import { Button } from '@/ui/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/ui/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/ui/components/ui/dropdown-menu'
import { Alert, AlertDescription } from '@/ui/components/ui/alert'
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from '@/ui/components/ui/field'
import { Input } from '@/ui/components/ui/input'
import { Spinner } from '@/ui/components/ui/spinner'
import { useT } from '@/ui/i18n'

export function UserMenu({ user }: { user: PublicUser }) {
  const t = useT()
  const logout = useLogout()
  const [passwordOpen, setPasswordOpen] = useState(false)
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" aria-label={t('user.menu')} title={t('user.signedInAs', { name: user.displayName })}>
            <span className="max-w-40 truncate font-medium">{user.displayName}</span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuLabel>{t('user.signedInAs', { name: user.displayName })}</DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => setPasswordOpen(true)}>
            <KeyRoundIcon data-icon="inline-start" />
            {t('user.changePassword')}
          </DropdownMenuItem>
          <DropdownMenuItem disabled={logout.isPending} onSelect={() => logout.mutate()}>
            <LogOutIcon data-icon="inline-start" />
            {t('user.signOut')}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <ChangePasswordDialog open={passwordOpen} onOpenChange={setPasswordOpen} />
    </>
  )
}

function ChangePasswordDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const t = useT()
  const change = useChangePassword()
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [touched, setTouched] = useState(false)

  const nextInvalid = next.length < 8 || new TextEncoder().encode(next).length > 72
  const currentInvalid = current === ''

  function close(value: boolean) {
    if (!value) {
      setCurrent('')
      setNext('')
      setTouched(false)
      change.reset()
    }
    onOpenChange(value)
  }

  function submit(event: FormEvent) {
    event.preventDefault()
    setTouched(true)
    if (nextInvalid || currentInvalid) return
    change.mutate(
      { current, next },
      {
        onSuccess: () => {
          toast.success(t('password.changed'))
          close(false)
        },
      },
    )
  }

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent>
        <form onSubmit={submit} noValidate className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>{t('password.title')}</DialogTitle>
            <DialogDescription>{t('password.description')}</DialogDescription>
          </DialogHeader>
          <FieldGroup>
            {change.error && (
              <Alert variant="destructive">
                <AlertDescription>{change.error.message || t('error.generic')}</AlertDescription>
              </Alert>
            )}
            <Field data-invalid={touched && currentInvalid}>
              <FieldLabel htmlFor="current-password">{t('password.current')}</FieldLabel>
              <Input
                id="current-password"
                type="password"
                autoComplete="current-password"
                value={current}
                onChange={(e) => setCurrent(e.target.value)}
                aria-invalid={touched && currentInvalid}
              />
              {touched && currentInvalid && <FieldError>{t('password.required')}</FieldError>}
            </Field>
            <Field data-invalid={touched && nextInvalid}>
              <FieldLabel htmlFor="new-password">{t('password.next')}</FieldLabel>
              <Input
                id="new-password"
                type="password"
                autoComplete="new-password"
                value={next}
                onChange={(e) => setNext(e.target.value)}
                aria-invalid={touched && nextInvalid}
              />
              {touched && nextInvalid ? (
                <FieldError>{t('password.length')}</FieldError>
              ) : (
                <FieldDescription>{t('password.hint')}</FieldDescription>
              )}
            </Field>
          </FieldGroup>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => close(false)}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" disabled={change.isPending}>
              {change.isPending && <Spinner data-icon="inline-start" />}
              {change.isPending ? t('password.submitting') : t('password.submit')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
