import { useId, useState, type ReactNode } from 'react'
import { AlertCircleIcon, SaveIcon } from 'lucide-react'
import { toast } from 'sonner'
import type { Integration } from '@/server/catalog/types'
import { ApiError } from '@/ui/api/client'
import { useIntegrations, useUpsertIntegration } from '@/ui/api/queries'
import { Alert, AlertDescription, AlertTitle } from '@/ui/components/ui/alert'
import { Button } from '@/ui/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/ui/components/ui/dialog'
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from '@/ui/components/ui/field'
import { Input } from '@/ui/components/ui/input'
import { Spinner } from '@/ui/components/ui/spinner'
import { Textarea } from '@/ui/components/ui/textarea'
import { useT } from '@/ui/i18n'

type FieldName = 'key' | 'name' | 'prefix' | 'description'
const FIELDS: readonly string[] = ['key', 'name', 'prefix', 'description']

/** The form field a server validation message names ("prefix must start with /" → prefix), if any. */
export function fieldOf(message: string): string | undefined {
  const word = /^(\w+)\b/.exec(message)?.[1]
  return word && FIELDS.includes(word) ? word : undefined
}

/** Add (no `integration`) or edit one integration in a dialog. The key is the identity: fixed when editing. */
export function IntegrationForm({
  integration,
  open,
  onOpenChange,
  onSaved,
}: {
  integration?: Integration
  open: boolean
  onOpenChange: (open: boolean) => void
  onSaved?: (saved: Integration) => void
}) {
  const t = useT()
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="glass-panel sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t(integration ? 'catalog.integration.editTitle' : 'catalog.integration.addTitle')}</DialogTitle>
          <DialogDescription className="text-xs">{t('catalog.integration.description')}</DialogDescription>
        </DialogHeader>
        {/* Radix mounts this only while open (and during the close animation), so each opening starts from the stored values. */}
        <Body integration={integration} onClose={() => onOpenChange(false)} onSaved={onSaved} />
      </DialogContent>
    </Dialog>
  )
}

function Body({ integration, onClose, onSaved }: { integration?: Integration; onClose: () => void; onSaved?: (saved: Integration) => void }) {
  const t = useT()
  const ids = useId()
  const id = (name: string) => `${ids}-${name}`
  const upsert = useUpsertIntegration({ createOnly: !integration })
  const existing = useIntegrations()
  const [form, setForm] = useState({
    key: integration?.key ?? '',
    name: integration?.name ?? '',
    prefix: integration?.prefix ?? '/',
    description: integration?.description ?? '',
  })
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
    // Fast path; the server refuses (409) an add over an existing key either way, even before the list loads.
    if (!integration && existing.data?.some((i) => i.key === form.key.trim())) {
      setErrors({ key: t('catalog.integration.keyTaken') })
      return
    }
    try {
      const saved = await upsert.mutateAsync({
        key: form.key.trim(),
        name: form.name.trim(),
        prefix: form.prefix.trim(),
        ...(form.description.trim() ? { description: form.description.trim() } : {}),
      })
      toast.success(t('catalog.integration.saved'))
      onSaved?.(saved)
      onClose()
    } catch (error) {
      const message = error instanceof Error && error.message ? error.message : t('error.generic')
      if (!integration && error instanceof ApiError && error.status === 409) {
        setErrors({ key: t('catalog.integration.keyTaken') })
        return
      }
      const field = error instanceof ApiError && error.status === 400 ? fieldOf(message) : undefined
      if (field) setErrors({ [field]: message })
      else setFormError(message)
    }
  }

  const input = (field: FieldName, label: string, extra: { hint?: string; mono?: boolean; disabled?: boolean; placeholder?: string } = {}) => (
    <Field data-invalid={Boolean(errors[field])}>
      <FieldLabel htmlFor={id(field)}>{label}</FieldLabel>
      <Input
        id={id(field)}
        dir={extra.mono ? 'ltr' : undefined}
        className={extra.mono ? 'font-mono' : undefined}
        autoComplete="off"
        spellCheck={false}
        disabled={extra.disabled}
        placeholder={extra.placeholder}
        value={form[field]}
        aria-invalid={Boolean(errors[field])}
        aria-describedby={[extra.hint && id(`${field}-hint`), errors[field] && id(`${field}-error`)].filter(Boolean).join(' ') || undefined}
        onChange={(e) => set(field, e.target.value)}
      />
      {extra.hint && <FieldDescription id={id(`${field}-hint`)} className="text-xs">{extra.hint}</FieldDescription>}
      {errors[field] && <FieldError id={id(`${field}-error`)}>{errors[field]}</FieldError>}
    </Field>
  )

  return (
    <form noValidate onSubmit={(e) => void submit(e)} className="flex flex-col gap-4">
      {formError && (
        <Alert variant="destructive">
          <AlertCircleIcon />
          <AlertTitle>{t('catalog.integration.saveFailed')}</AlertTitle>
          <AlertDescription>{formError}</AlertDescription>
        </Alert>
      )}
      <FieldGroup className="gap-4">
        {input('key', t('catalog.integration.key'), { mono: true, disabled: Boolean(integration), hint: integration ? undefined : t('catalog.integration.keyHint'), placeholder: 'blog' })}
        {input('name', t('catalog.integration.name'))}
        {input('prefix', t('catalog.integration.prefix'), { mono: true, hint: t('catalog.integration.prefixHint'), placeholder: '/blog' })}
        <Field data-invalid={Boolean(errors.description)}>
          <FieldLabel htmlFor={id('description')}>{t('catalog.integration.descriptionLabel')}</FieldLabel>
          <Textarea
            id={id('description')}
            rows={3}
            value={form.description}
            aria-invalid={Boolean(errors.description)}
            onChange={(e) => set('description', e.target.value)}
          />
          {errors.description && <FieldError>{errors.description}</FieldError>}
        </Field>
      </FieldGroup>
      <FormFooter pending={upsert.isPending} onCancel={onClose} />
    </form>
  )
}

export function FormFooter({ pending, onCancel, children }: { pending: boolean; onCancel: () => void; children?: ReactNode }) {
  const t = useT()
  return (
    <DialogFooter>
      {children}
      <Button type="button" variant="outline" onClick={onCancel}>
        {t('common.cancel')}
      </Button>
      <Button type="submit" disabled={pending}>
        {pending ? <Spinner data-icon="inline-start" /> : <SaveIcon data-icon="inline-start" />}
        {pending ? t('catalog.saving') : t('catalog.save')}
      </Button>
    </DialogFooter>
  )
}
