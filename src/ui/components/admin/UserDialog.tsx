import { useId, useState } from 'react'
import { AlertCircleIcon, KeyRoundIcon, UserPlusIcon } from 'lucide-react'
import { toast } from 'sonner'
import type { PublicUser } from '@/server/users/types'
import { useCreateUser, useUpdateUser } from '@/ui/api/queries'
import { Alert, AlertDescription, AlertTitle } from '@/ui/components/ui/alert'
import { Button } from '@/ui/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/ui/components/ui/dialog'
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from '@/ui/components/ui/field'
import { Input } from '@/ui/components/ui/input'
import { Spinner } from '@/ui/components/ui/spinner'
import { useT } from '@/ui/i18n'

type FieldName = 'username' | 'displayName' | 'password'

/** The form field a server message names ("password must be 8–72 characters" → password), if any. */
function fieldOf(message: string): FieldName | undefined {
  if (/^Username already exists/i.test(message)) return 'username'
  const word = /^(\w+)\b/.exec(message)?.[1]
  return word === 'username' || word === 'displayName' || word === 'password' ? word : undefined
}

/** Add a user (no `user`) or reset one user's password (`user`). */
export function UserDialog({ user, open, onOpenChange }: { user?: PublicUser; open: boolean; onOpenChange: (open: boolean) => void }) {
  const t = useT()
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="glass-panel sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{user ? t('users.form.resetTitle', { name: user.username }) : t('users.form.addTitle')}</DialogTitle>
          <DialogDescription className="text-xs">{t(user ? 'users.form.resetDescription' : 'users.form.addDescription')}</DialogDescription>
        </DialogHeader>
        {/* Mounted only while open, so every opening starts empty. */}
        <Body user={user} onClose={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  )
}

function Body({ user, onClose }: { user?: PublicUser; onClose: () => void }) {
  const t = useT()
  const ids = useId()
  const id = (name: string) => `${ids}-${name}`
  const create = useCreateUser()
  const update = useUpdateUser()
  const pending = create.isPending || update.isPending
  const [form, setForm] = useState({ username: '', displayName: '', password: '' })
  const [errors, setErrors] = useState<Partial<Record<FieldName, string>>>({})
  const [formError, setFormError] = useState<string | null>(null)

  const set = (field: FieldName, value: string) => {
    setForm((f) => ({ ...f, [field]: value }))
    setErrors((e) => ({ ...e, [field]: undefined }))
  }

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    setErrors({})
    setFormError(null)
    try {
      if (user) {
        await update.mutateAsync({ id: user.id, password: form.password })
        toast.success(t('users.passwordReset'))
      } else {
        const username = form.username.trim()
        const displayName = form.displayName.trim()
        await create.mutateAsync({ username, ...(displayName ? { displayName } : {}), password: form.password })
        toast.success(t('users.created', { name: username.toLowerCase() }))
      }
      onClose()
    } catch (error) {
      const message = error instanceof Error && error.message ? error.message : t('error.generic')
      const field = fieldOf(message)
      if (field && (user ? field === 'password' : true)) setErrors({ [field]: message })
      else setFormError(message)
    }
  }

  const field = (name: FieldName, label: string, extra: { hint?: string; type?: string; mono?: boolean; autoComplete?: string } = {}) => (
    <Field data-invalid={Boolean(errors[name])}>
      <FieldLabel htmlFor={id(name)}>{label}</FieldLabel>
      <Input
        id={id(name)}
        type={extra.type}
        dir={extra.mono ? 'ltr' : undefined}
        className={extra.mono ? 'font-mono' : undefined}
        autoComplete={extra.autoComplete ?? 'off'}
        spellCheck={false}
        value={form[name]}
        aria-invalid={Boolean(errors[name])}
        aria-describedby={[extra.hint && id(`${name}-hint`), errors[name] && id(`${name}-error`)].filter(Boolean).join(' ') || undefined}
        onChange={(e) => set(name, e.target.value)}
      />
      {extra.hint && <FieldDescription id={id(`${name}-hint`)} className="text-xs">{extra.hint}</FieldDescription>}
      {errors[name] && <FieldError id={id(`${name}-error`)}>{errors[name]}</FieldError>}
    </Field>
  )

  return (
    <form noValidate onSubmit={(e) => void submit(e)} className="flex flex-col gap-4">
      {formError && (
        <Alert variant="destructive">
          <AlertCircleIcon />
          <AlertTitle>{t('users.form.failed')}</AlertTitle>
          <AlertDescription>{formError}</AlertDescription>
        </Alert>
      )}
      <FieldGroup className="gap-4">
        {!user && field('username', t('users.form.username'), { hint: t('users.form.usernameHint'), mono: true })}
        {!user && field('displayName', t('users.form.displayName'), { hint: t('users.form.displayNameHint') })}
        {field('password', t(user ? 'users.form.newPassword' : 'users.form.password'), {
          type: 'password',
          hint: t('users.form.passwordHint'),
          autoComplete: 'new-password',
        })}
      </FieldGroup>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose}>
          {t('common.cancel')}
        </Button>
        <Button type="submit" disabled={pending}>
          {pending ? <Spinner data-icon="inline-start" /> : user ? <KeyRoundIcon data-icon="inline-start" /> : <UserPlusIcon data-icon="inline-start" />}
          {t(pending ? (user ? 'users.form.resetting' : 'users.form.creating') : user ? 'users.form.reset' : 'users.form.create')}
        </Button>
      </DialogFooter>
    </form>
  )
}
