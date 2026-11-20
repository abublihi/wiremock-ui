import { useId, useState } from 'react'
import { AlertCircleIcon, PlusIcon, SaveIcon, XIcon } from 'lucide-react'
import { toast } from 'sonner'
import type { Endpoint, KeyLocation } from '@/server/catalog/types'
import { ApiError } from '@/ui/api/client'
import { useEndpoints, useUpsertEndpoint } from '@/ui/api/queries'
import { Alert, AlertDescription, AlertTitle } from '@/ui/components/ui/alert'
import { Button } from '@/ui/components/ui/button'
import { Eyebrow } from '@/ui/components/editor/EditorShell'
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel, FieldLegend, FieldSet } from '@/ui/components/ui/field'
import { Input } from '@/ui/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/ui/components/ui/select'
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from '@/ui/components/ui/sheet'
import { Spinner } from '@/ui/components/ui/spinner'
import { Textarea } from '@/ui/components/ui/textarea'
import { ToggleGroup, ToggleGroupItem } from '@/ui/components/ui/toggle-group'
import { StatusBadge } from '@/ui/components/common/StatusBadge'
import { useT } from '@/ui/i18n'
import { ExampleEditor } from './ExampleEditor'

const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS', 'ANY'] as const
const PATH_TYPES = ['exact', 'template', 'regex'] as const
const LOCATIONS: readonly KeyLocation[] = ['jsonPath', 'xPath', 'query', 'path', 'header', 'form']
const CONTENT_TYPES = ['json', 'xml', 'text', 'html'] as const
const NO_LOOKUP = 'none'
const ON = 'data-[state=on]:border-signal/50 data-[state=on]:bg-signal/10 data-[state=on]:text-signal-fg'

/** What the lookup expression looks like for each location (the "path" one names a {variable} of the path). */
const EXPRESSION_PLACEHOLDER: Record<KeyLocation, string> = {
  jsonPath: '$.idNo',
  xPath: '/Envelope/Body/id',
  query: 'id',
  path: 'id',
  header: 'X-Account-Id',
  form: 'accountId',
}

type Form = {
  key: string
  name: string
  method: string
  path: string
  pathType: Endpoint['pathType']
  location: KeyLocation | typeof NO_LOOKUP
  expression: string
  contentType: Endpoint['contentType']
  statuses: number[]
  exampleRequest: string
  examples: Record<string, string>
  description: string
  links: { label: string; url: string }[]
}

function initialForm(endpoint?: Endpoint): Form {
  return {
    key: endpoint?.key ?? '',
    name: endpoint?.name ?? '',
    method: endpoint?.method ?? 'GET',
    path: endpoint?.path ?? '/',
    pathType: endpoint?.pathType ?? 'exact',
    location: endpoint?.lookup?.location ?? NO_LOOKUP,
    expression: endpoint?.lookup?.expression ?? '',
    contentType: endpoint?.contentType ?? 'json',
    statuses: endpoint?.allowedStatuses ?? [],
    exampleRequest: endpoint?.exampleRequest ?? '',
    examples: endpoint?.exampleResponses ?? {},
    description: endpoint?.description ?? '',
    links: endpoint?.links ?? [],
  }
}

/** The form field a server validation message names, as a key into `errors` ("links.0.url must…" → "link-0"). */
export function endpointFieldOf(message: string): string | undefined {
  const m = /^(\w+)(?:\.(\w+))?/.exec(message)
  if (!m) return undefined
  const [, head, sub] = m
  switch (head) {
    case 'key': case 'name': case 'method': case 'path': case 'pathType': case 'contentType': case 'description':
    case 'exampleRequest':
      return head
    case 'lookup':
      return sub === 'expression' ? 'expression' : 'location'
    case 'allowedStatuses':
      return 'statuses'
    case 'exampleResponses':
      return sub && /^\d+$/.test(sub) ? `example-${sub}` : undefined
    case 'links':
      return sub && /^\d+$/.test(sub) ? `link-${sub}` : undefined
    default:
      return undefined
  }
}

/** Add (no `endpoint`) or edit one endpoint of `integration` in a sheet. The key is fixed when editing. */
export function EndpointForm({
  integration,
  endpoint,
  open,
  onOpenChange,
}: {
  integration: { key: string; name: string }
  endpoint?: Endpoint
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const t = useT()
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="flex w-full flex-col gap-0 sm:max-w-2xl">
        <SheetHeader>
          <SheetTitle>{t(endpoint ? 'catalog.endpoint.editTitle' : 'catalog.endpoint.addTitle')}</SheetTitle>
          <SheetDescription className="text-xs">{t('catalog.endpoint.description', { name: integration.name })}</SheetDescription>
        </SheetHeader>
        {/* Radix mounts this only while open (and during the close animation), so each opening starts from the stored values. */}
        <Body integration={integration.key} endpoint={endpoint} onClose={() => onOpenChange(false)} />
      </SheetContent>
    </Sheet>
  )
}

function Body({ integration, endpoint, onClose }: { integration: string; endpoint?: Endpoint; onClose: () => void }) {
  const t = useT()
  const ids = useId()
  const id = (name: string) => `${ids}-${name}`
  const upsert = useUpsertEndpoint()
  const existing = useEndpoints(integration)
  const [form, setForm] = useState<Form>(() => initialForm(endpoint))
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [statusText, setStatusText] = useState('')

  const update = (patch: Partial<Form>, clears: string[] = []) => {
    setForm((f) => ({ ...f, ...patch }))
    if (clears.some((c) => errors[c])) setErrors((e) => Object.fromEntries(Object.entries(e).filter(([k]) => !clears.includes(k))))
  }
  const described = (field: string, hint?: boolean) =>
    [hint && id(`${field}-hint`), errors[field] && id(`${field}-error`)].filter(Boolean).join(' ') || undefined
  const fieldError = (field: string) => (errors[field] ? <FieldError id={id(`${field}-error`)}>{errors[field]}</FieldError> : null)

  const addStatus = () => {
    const text = statusText.trim()
    if (!text) return
    const n = Number(text)
    if (!Number.isInteger(n) || n < 100 || n > 599) {
      setErrors((e) => ({ ...e, statuses: t('catalog.endpoint.statusInvalid') }))
      return
    }
    update({ statuses: form.statuses.includes(n) ? form.statuses : [...form.statuses, n].sort((a, b) => a - b) }, ['statuses'])
    setStatusText('')
  }

  // One example per allowed status, plus any stored example whose status is no longer listed (clear its body to drop it).
  const exampleStatuses = [...new Set([...form.statuses.map(String), ...Object.keys(form.examples)])].sort()

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    setErrors({})
    setFormError(null)
    // A PUT is an upsert: adding over an existing key would silently replace it.
    if (!endpoint && existing.data?.some((e) => e.key === form.key.trim())) {
      setErrors({ key: t('catalog.endpoint.keyTaken') })
      return
    }
    const exampleResponses = Object.fromEntries(Object.entries(form.examples).filter(([, body]) => body.trim() !== ''))
    const links = form.links.filter((l) => l.label.trim() || l.url.trim()).map((l) => ({ label: l.label.trim(), url: l.url.trim() }))
    try {
      await upsert.mutateAsync({
        integration,
        key: form.key.trim(),
        name: form.name.trim(),
        method: form.method,
        path: form.path.trim(),
        pathType: form.pathType,
        ...(form.location !== NO_LOOKUP ? { lookup: { location: form.location, expression: form.expression.trim() } } : {}),
        contentType: form.contentType,
        ...(form.exampleRequest.trim() ? { exampleRequest: form.exampleRequest } : {}),
        exampleResponses,
        allowedStatuses: form.statuses,
        ...(form.description.trim() ? { description: form.description.trim() } : {}),
        ...(links.length > 0 ? { links } : {}),
      })
      toast.success(t('catalog.saved'))
      onClose()
    } catch (error) {
      const message = error instanceof Error && error.message ? error.message : t('error.generic')
      const field = error instanceof ApiError && error.status === 400 ? endpointFieldOf(message) : undefined
      if (field) setErrors({ [field]: message })
      else setFormError(message)
    }
  }

  const text = (field: 'key' | 'name' | 'path' | 'expression', label: string, extra: { hint?: string; mono?: boolean; disabled?: boolean; placeholder?: string } = {}) => (
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
        aria-describedby={described(field, Boolean(extra.hint))}
        onChange={(e) => update({ [field]: e.target.value }, [field])}
      />
      {extra.hint && <FieldDescription id={id(`${field}-hint`)} className="text-xs">{extra.hint}</FieldDescription>}
      {fieldError(field)}
    </Field>
  )

  return (
    <form noValidate onSubmit={(e) => void submit(e)} className="flex min-h-0 flex-1 flex-col">
      <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto px-4 pb-4">
        {formError && (
          <Alert variant="destructive">
            <AlertCircleIcon />
            <AlertTitle>{t('catalog.saveFailed')}</AlertTitle>
            <AlertDescription>{formError}</AlertDescription>
          </Alert>
        )}

        <section className="flex flex-col gap-4">
          <Eyebrow>{t('catalog.endpoint.section.request')}</Eyebrow>
          <FieldGroup className="gap-4">
            <div className="grid gap-4 sm:grid-cols-2">
              {text('key', t('catalog.endpoint.key'), { mono: true, disabled: Boolean(endpoint), hint: endpoint ? undefined : t('catalog.endpoint.keyHint'), placeholder: 'get-citizen-info' })}
              {text('name', t('catalog.endpoint.name'))}
            </div>
            <div className="grid grid-cols-[8rem_1fr] gap-4">
              <Field data-invalid={Boolean(errors.method)}>
                <FieldLabel htmlFor={id('method')}>{t('catalog.endpoint.method')}</FieldLabel>
                <Select value={form.method} onValueChange={(method) => update({ method }, ['method'])}>
                  <SelectTrigger id={id('method')} className="w-full font-mono" aria-invalid={Boolean(errors.method)}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {METHODS.map((m) => (
                      <SelectItem key={m} value={m} className="font-mono">
                        {m}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {fieldError('method')}
              </Field>
              {text('path', t('catalog.endpoint.path'), { mono: true, placeholder: form.pathType === 'template' ? '/citizens/{id}' : '/citizens' })}
            </div>
            <FieldSet className="gap-2">
              <FieldLegend variant="label">{t('catalog.endpoint.pathType')}</FieldLegend>
              <ToggleGroup
                type="single"
                variant="outline"
                size="sm"
                spacing={1}
                value={form.pathType}
                aria-label={t('catalog.endpoint.pathType')}
                onValueChange={(v) => v && update({ pathType: v as Form['pathType'] }, ['pathType', 'path', 'location'])}
              >
                {PATH_TYPES.map((p) => (
                  <ToggleGroupItem key={p} value={p} className={ON}>
                    {t(`catalog.endpoint.pathType.${p}`)}
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
              <FieldDescription className="text-xs">{t(`catalog.endpoint.pathHint.${form.pathType}`)}</FieldDescription>
              {fieldError('pathType')}
            </FieldSet>
            <Field data-invalid={Boolean(errors.contentType)}>
              <FieldLabel htmlFor={id('contentType')}>{t('catalog.endpoint.contentType')}</FieldLabel>
              <Select value={form.contentType} onValueChange={(v) => update({ contentType: v as Form['contentType'] }, ['contentType'])}>
                <SelectTrigger id={id('contentType')} className="w-full sm:w-48" aria-invalid={Boolean(errors.contentType)}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CONTENT_TYPES.map((c) => (
                    <SelectItem key={c} value={c}>
                      {t(`catalog.endpoint.contentType.${c}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {fieldError('contentType')}
            </Field>
            <Field data-invalid={Boolean(errors.exampleRequest)}>
              <FieldLabel id={id('exampleRequest-label')}>{t('catalog.endpoint.exampleRequest')}</FieldLabel>
              <ExampleEditor
                value={form.exampleRequest}
                onChange={(exampleRequest) => update({ exampleRequest }, ['exampleRequest'])}
                contentType={form.contentType}
                label={t('catalog.endpoint.exampleRequest')}
                invalid={Boolean(errors.exampleRequest)}
                describedBy={described('exampleRequest')}
              />
              {fieldError('exampleRequest')}
            </Field>
          </FieldGroup>
        </section>

        <section className="flex flex-col gap-4">
          <Eyebrow>{t('catalog.endpoint.section.lookup')}</Eyebrow>
          <FieldGroup className="gap-4">
            <Field data-invalid={Boolean(errors.location)}>
              <FieldLabel htmlFor={id('location')}>{t('catalog.endpoint.lookup')}</FieldLabel>
              <Select
                value={form.location}
                onValueChange={(v) => update({ location: v as Form['location'], ...(v === NO_LOOKUP ? { expression: '' } : {}) }, ['location', 'expression'])}
              >
                <SelectTrigger id={id('location')} className="w-full sm:w-72" aria-invalid={Boolean(errors.location)} aria-describedby={described('location', true)}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_LOOKUP}>{t('catalog.endpoint.lookupNone')}</SelectItem>
                  {LOCATIONS.map((l) => (
                    <SelectItem key={l} value={l}>
                      {t(`catalog.endpoint.lookup.${l}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FieldDescription id={id('location-hint')} className="text-xs">{t('catalog.endpoint.lookupHint')}</FieldDescription>
              {fieldError('location')}
            </Field>
            {form.location !== NO_LOOKUP &&
              text('expression', t('catalog.endpoint.expression'), { mono: true, placeholder: EXPRESSION_PLACEHOLDER[form.location] })}
          </FieldGroup>
        </section>

        <section className="flex flex-col gap-4">
          <Eyebrow>{t('catalog.endpoint.section.responses')}</Eyebrow>
          <FieldGroup className="gap-4">
            <FieldSet className="gap-2" data-invalid={Boolean(errors.statuses)}>
              <FieldLegend variant="label">{t('catalog.endpoint.statuses')}</FieldLegend>
              {form.statuses.length > 0 && (
                <ul className="flex flex-wrap gap-1.5" aria-label={t('catalog.endpoint.statuses')}>
                  {form.statuses.map((s) => (
                    <li key={s} className="inline-flex items-center gap-1">
                      <StatusBadge status={s} />
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-xs"
                        aria-label={t('catalog.endpoint.statusRemove', { status: s })}
                        onClick={() => update({ statuses: form.statuses.filter((x) => x !== s) })}
                      >
                        <XIcon />
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
              <div className="flex max-w-xs gap-2">
                <Input
                  type="number"
                  inputMode="numeric"
                  min={100}
                  max={599}
                  className="font-mono"
                  placeholder={t('catalog.endpoint.statusAddPlaceholder')}
                  aria-label={t('catalog.endpoint.statusAdd')}
                  aria-invalid={Boolean(errors.statuses)}
                  aria-describedby={described('statuses', true)}
                  value={statusText}
                  onChange={(e) => setStatusText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      addStatus()
                    }
                  }}
                />
                <Button type="button" variant="outline" onClick={addStatus}>
                  <PlusIcon data-icon="inline-start" />
                  {t('catalog.endpoint.statusAdd')}
                </Button>
              </div>
              <FieldDescription id={id('statuses-hint')} className="text-xs">{t('catalog.endpoint.statusesHint')}</FieldDescription>
              {fieldError('statuses')}
            </FieldSet>

            {exampleStatuses.length === 0 ? (
              <p className="text-xs text-muted-foreground">{t('catalog.endpoint.examplesHint')}</p>
            ) : (
              exampleStatuses.map((status) => (
                <Field key={status} data-invalid={Boolean(errors[`example-${status}`])}>
                  <FieldLabel id={id(`example-${status}-label`)}>{t('catalog.endpoint.exampleResponse', { status })}</FieldLabel>
                  <ExampleEditor
                    value={form.examples[status] ?? ''}
                    onChange={(body) => update({ examples: { ...form.examples, [status]: body } }, [`example-${status}`])}
                    contentType={form.contentType}
                    label={t('catalog.endpoint.exampleResponse', { status })}
                    invalid={Boolean(errors[`example-${status}`])}
                    describedBy={described(`example-${status}`)}
                  />
                  {fieldError(`example-${status}`)}
                </Field>
              ))
            )}
          </FieldGroup>
        </section>

        <section className="flex flex-col gap-4">
          <Eyebrow>{t('catalog.endpoint.section.about')}</Eyebrow>
          <FieldGroup className="gap-4">
            <Field data-invalid={Boolean(errors.description)}>
              <FieldLabel htmlFor={id('description')}>{t('catalog.endpoint.descriptionLabel')}</FieldLabel>
              <Textarea
                id={id('description')}
                rows={3}
                value={form.description}
                aria-invalid={Boolean(errors.description)}
                aria-describedby={described('description')}
                onChange={(e) => update({ description: e.target.value }, ['description'])}
              />
              {fieldError('description')}
            </Field>
            <FieldSet className="gap-2">
              <FieldLegend variant="label">{t('catalog.endpoint.links')}</FieldLegend>
              {form.links.map((link, i) => (
                <Field key={i} data-invalid={Boolean(errors[`link-${i}`])}>
                  <div className="flex items-start gap-2">
                    <Input
                      className="w-1/3"
                      aria-label={`${t('catalog.endpoint.linkLabel')} ${i + 1}`}
                      placeholder={t('catalog.endpoint.linkLabel')}
                      value={link.label}
                      onChange={(e) => update({ links: form.links.map((l, j) => (j === i ? { ...l, label: e.target.value } : l)) }, [`link-${i}`])}
                    />
                    <Input
                      dir="ltr"
                      className="flex-1 font-mono"
                      type="url"
                      aria-label={`${t('catalog.endpoint.linkUrl')} ${i + 1}`}
                      placeholder="https://"
                      aria-invalid={Boolean(errors[`link-${i}`])}
                      aria-describedby={described(`link-${i}`)}
                      value={link.url}
                      onChange={(e) => update({ links: form.links.map((l, j) => (j === i ? { ...l, url: e.target.value } : l)) }, [`link-${i}`])}
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label={t('catalog.endpoint.linkRemove', { n: i + 1 })}
                      onClick={() => update({ links: form.links.filter((_, j) => j !== i) })}
                    >
                      <XIcon />
                    </Button>
                  </div>
                  {fieldError(`link-${i}`)}
                </Field>
              ))}
              <Button type="button" variant="outline" size="sm" className="w-fit" onClick={() => update({ links: [...form.links, { label: '', url: '' }] })}>
                <PlusIcon data-icon="inline-start" />
                {t('catalog.endpoint.linkAdd')}
              </Button>
            </FieldSet>
          </FieldGroup>
        </section>
      </div>

      <SheetFooter className="flex-row justify-end border-t border-line">
        <Button type="button" variant="outline" onClick={onClose}>
          {t('common.cancel')}
        </Button>
        <Button type="submit" disabled={upsert.isPending}>
          {upsert.isPending ? <Spinner data-icon="inline-start" /> : <SaveIcon data-icon="inline-start" />}
          {upsert.isPending ? t('catalog.saving') : t('catalog.save')}
        </Button>
      </SheetFooter>
    </form>
  )
}
