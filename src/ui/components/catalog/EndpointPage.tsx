import { useId, useRef, useState, type ReactNode } from 'react'
import { Link, useBlocker, useNavigate } from '@tanstack/react-router'
import { AlertCircleIcon, ArrowLeftIcon, PlusIcon, SaveIcon, XIcon } from 'lucide-react'
import { toast } from 'sonner'
import type { Endpoint, Integration, KeyLocation } from '@/server/catalog/types'
import { ApiError } from '@/ui/api/client'
import { useEndpoints, useIntegrations, useUpsertEndpoint } from '@/ui/api/queries'
import { MethodBadge } from '@/ui/components/common/MethodBadge'
import { StatusBadge } from '@/ui/components/common/StatusBadge'
import { EditorShell, Eyebrow, backLinkClass } from '@/ui/components/editor/EditorShell'
import { keyLabel } from '@/ui/components/editor/EndpointPicker'
import { Alert, AlertDescription, AlertTitle } from '@/ui/components/ui/alert'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/ui/components/ui/alert-dialog'
import { Button } from '@/ui/components/ui/button'
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel, FieldLegend, FieldSet } from '@/ui/components/ui/field'
import { Input } from '@/ui/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/ui/components/ui/select'
import { Skeleton } from '@/ui/components/ui/skeleton'
import { Spinner } from '@/ui/components/ui/spinner'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/ui/components/ui/tabs'
import { Textarea } from '@/ui/components/ui/textarea'
import { ToggleGroup, ToggleGroupItem } from '@/ui/components/ui/toggle-group'
import { useT } from '@/ui/i18n'
import { ExampleEditor } from './ExampleEditor'

const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS', 'ANY'] as const
const PATH_TYPES = ['exact', 'template', 'regex'] as const
const LOCATIONS: readonly KeyLocation[] = ['jsonPath', 'xPath', 'query', 'path', 'header', 'form']
const CONTENT_TYPES = ['json', 'xml', 'text', 'html'] as const
const NO_LOOKUP = 'none'
const ON = 'data-[state=on]:border-signal/50 data-[state=on]:bg-signal/10 data-[state=on]:text-signal-fg'
const TAB =
  'px-3 font-mono text-xs data-active:border-signal/40 data-active:bg-signal/10 data-active:text-signal-fg dark:data-active:border-signal/40 dark:data-active:bg-signal/10 dark:data-active:text-signal-fg'

/** What the key expression looks like for each location (the "path" one names a {variable} of the path). */
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

const prefixOf = (integration: Pick<Integration, 'prefix'>) => (integration.prefix === '/' ? '' : integration.prefix)

/**
 * Add (no `endpointKey`) or edit one endpoint of an integration, on its own page:
 * `/catalog/$key/endpoints/new` and `/catalog/$key/endpoints/$endpoint/edit`.
 */
export function EndpointPage({ integrationKey, endpointKey }: { integrationKey: string; endpointKey?: string }) {
  const t = useT()
  const integrations = useIntegrations()
  const endpoints = useEndpoints(integrationKey)
  const integration = integrations.data?.find((i) => i.key === integrationKey)
  const endpoint = endpointKey ? endpoints.data?.find((e) => e.key === endpointKey) : undefined
  const title = t(endpointKey ? 'catalog.endpoint.editTitle' : 'catalog.endpoint.addTitle')
  const back = (
    <Link to="/catalog/$key" params={{ key: integrationKey }} className={backLinkClass}>
      <ArrowLeftIcon aria-hidden className="size-3.5 rtl:rotate-180" />
      {t('catalog.endpoint.backTo', { name: integration?.name ?? integrationKey })}
    </Link>
  )

  // A new endpoint only waits for the integration; an edit also needs the stored endpoint.
  if (integrations.isPending || (endpointKey && endpoints.isPending)) {
    return (
      <EditorShell title={title} caption="//" back={back}>
        <Skeleton className="h-96 w-full" />
      </EditorShell>
    )
  }
  const error = integrations.error ?? (endpointKey ? endpoints.error : null)
  if (error || !integration || (endpointKey && !endpoint)) {
    return (
      <EditorShell title={title} caption="//" back={back}>
        <Alert variant={error ? 'destructive' : 'default'}>
          <AlertCircleIcon />
          <AlertTitle>{error ? t('catalog.loadFailed') : !integration ? t('catalog.notFoundTitle') : t('catalog.endpoint.notFoundTitle')}</AlertTitle>
          <AlertDescription>
            {error
              ? error.message
              : !integration
                ? t('catalog.notFoundBody', { key: integrationKey })
                : t('catalog.endpoint.notFoundBody', { integration: integration.name, key: endpointKey ?? '' })}
          </AlertDescription>
        </Alert>
      </EditorShell>
    )
  }
  return <EndpointEditor key={endpoint?.key ?? '+new'} integration={integration} endpoint={endpoint} title={title} back={back} />
}

function EndpointEditor({ integration, endpoint, title, back }: { integration: Integration; endpoint?: Endpoint; title: string; back: ReactNode }) {
  const t = useT()
  const navigate = useNavigate()
  const ids = useId()
  const id = (name: string) => `${ids}-${name}`
  const upsert = useUpsertEndpoint({ createOnly: !endpoint })
  const existing = useEndpoints(integration.key)
  const [initial] = useState<Form>(() => initialForm(endpoint))
  const [form, setForm] = useState<Form>(initial)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [statusText, setStatusText] = useState('')
  const [exampleTab, setExampleTab] = useState<string | undefined>(undefined)

  // Leaving with unsaved changes asks first (in-app navigation and closing the tab).
  const dirty = JSON.stringify(form) !== JSON.stringify(initial)
  const dirtyRef = useRef(dirty)
  dirtyRef.current = dirty
  const leaving = useRef(false)
  const blocker = useBlocker({
    shouldBlockFn: () => dirtyRef.current && !leaving.current,
    enableBeforeUnload: () => dirtyRef.current && !leaving.current,
    withResolver: true,
  })

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
  const activeTab = exampleTab && exampleStatuses.includes(exampleTab) ? exampleTab : exampleStatuses[0]
  const prefix = prefixOf(integration)

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    setErrors({})
    setFormError(null)
    const key = form.key.trim()
    // Fast path; the server refuses (409) an add over an existing key either way, even before the list loads.
    if (!endpoint && existing.data?.some((e) => e.key === key)) {
      setErrors({ key: t('catalog.endpoint.keyTaken') })
      return
    }
    const exampleResponses = Object.fromEntries(Object.entries(form.examples).filter(([, body]) => body.trim() !== ''))
    const links = form.links.filter((l) => l.label.trim() || l.url.trim()).map((l) => ({ label: l.label.trim(), url: l.url.trim() }))
    try {
      const saved = await upsert.mutateAsync({
        integration: integration.key,
        key,
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
      leaving.current = true
      const name = saved?.name || form.name.trim()
      toast.success(t('catalog.endpoint.saved', { name }), {
        action: {
          label: t('catalog.endpoint.newMockAction'),
          onClick: () => void navigate({ to: '/mocks/new', search: { integration: integration.key, endpoint: key } }),
        },
      })
      await navigate({ to: '/catalog/$key', params: { key: integration.key } })
    } catch (error) {
      const message = error instanceof Error && error.message ? error.message : t('error.generic')
      if (!endpoint && error instanceof ApiError && error.status === 409) {
        setErrors({ key: t('catalog.endpoint.keyTaken') })
        return
      }
      const field = error instanceof ApiError && error.status === 400 ? endpointFieldOf(message) : undefined
      if (field) setErrors({ [field]: message })
      else setFormError(message)
    }
  }

  const text = (
    field: 'key' | 'name' | 'path' | 'expression',
    label: string,
    extra: { hint?: string; mono?: boolean; disabled?: boolean; placeholder?: string } = {},
  ) => (
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
      {extra.hint && (
        <FieldDescription id={id(`${field}-hint`)} className="text-xs">
          {extra.hint}
        </FieldDescription>
      )}
      {fieldError(field)}
    </Field>
  )

  const caption = endpoint
    ? t('catalog.endpoint.editCaption', { integration: integration.name, endpoint: endpoint.name })
    : t('catalog.endpoint.description', { name: integration.name })

  return (
    <EditorShell
      title={title}
      caption={caption}
      back={back}
      aside={<TesterPreview integration={integration} form={form} />}
    >
      <form noValidate onSubmit={(e) => void submit(e)} className="flex flex-col gap-5">
        {formError && (
          <Alert variant="destructive">
            <AlertCircleIcon />
            <AlertTitle>{t('catalog.endpoint.saveFailed')}</AlertTitle>
            <AlertDescription>{formError}</AlertDescription>
          </Alert>
        )}

        <Section title={t('catalog.endpoint.section.request')}>
          <FieldGroup className="gap-4">
            <div className="grid gap-4 sm:grid-cols-2">
              {text('name', t('catalog.endpoint.name'), { placeholder: 'Fetch citizen' })}
              {text('key', t('catalog.endpoint.key'), {
                mono: true,
                disabled: Boolean(endpoint),
                hint: endpoint ? undefined : t('catalog.endpoint.keyHint'),
                placeholder: 'fetch-citizen',
              })}
            </div>
            <div className="grid grid-cols-[7.5rem_minmax(0,1fr)] gap-4">
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
              {text('path', t('catalog.endpoint.path'), {
                mono: true,
                placeholder: form.pathType === 'template' ? '/citizens/{id}' : form.pathType === 'regex' ? '/citizens/[0-9]+' : '/citizens/fetch',
              })}
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
              <FieldDescription className="text-xs">{t(`catalog.endpoint.pathHint.${form.pathType}`, { prefix })}</FieldDescription>
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
          </FieldGroup>
        </Section>

        <Section title={t('catalog.endpoint.section.key')}>
          <p className="text-xs leading-relaxed text-muted-foreground">{t('catalog.endpoint.keyIntro')}</p>
          <FieldGroup className="gap-4">
            <Field data-invalid={Boolean(errors.location)}>
              <FieldLabel htmlFor={id('location')}>{t('catalog.endpoint.lookup')}</FieldLabel>
              <Select
                value={form.location}
                onValueChange={(v) => update({ location: v as Form['location'], ...(v === NO_LOOKUP ? { expression: '' } : {}) }, ['location', 'expression'])}
              >
                <SelectTrigger id={id('location')} className="w-full sm:w-80" aria-invalid={Boolean(errors.location)} aria-describedby={described('location', true)}>
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
              <FieldDescription id={id('location-hint')} className="text-xs">
                {t(`catalog.endpoint.lookupHelp.${form.location}`)}
              </FieldDescription>
              {fieldError('location')}
            </Field>
            {form.location !== NO_LOOKUP &&
              text('expression', t('catalog.endpoint.expression'), { mono: true, placeholder: EXPRESSION_PLACEHOLDER[form.location] })}
          </FieldGroup>
        </Section>

        <Section title={t('catalog.endpoint.section.examples')}>
          <p className="text-xs leading-relaxed text-muted-foreground">{t('catalog.endpoint.examplesIntro')}</p>
          <FieldGroup className="gap-5">
            <Field data-invalid={Boolean(errors.exampleRequest)}>
              <FieldLabel id={id('exampleRequest-label')}>{t('catalog.endpoint.exampleRequest')}</FieldLabel>
              <ExampleEditor
                value={form.exampleRequest}
                onChange={(exampleRequest) => update({ exampleRequest }, ['exampleRequest'])}
                contentType={form.contentType}
                label={t('catalog.endpoint.exampleRequest')}
                invalid={Boolean(errors.exampleRequest)}
                describedBy={described('exampleRequest')}
                size="large"
              />
              {fieldError('exampleRequest')}
            </Field>

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
              <FieldDescription id={id('statuses-hint')} className="text-xs">
                {t('catalog.endpoint.statusesHint')}
              </FieldDescription>
              {fieldError('statuses')}
            </FieldSet>

            <FieldSet className="gap-2">
              <FieldLegend variant="label">{t('catalog.endpoint.exampleResponses')}</FieldLegend>
              {exampleStatuses.length === 0 ? (
                <p className="text-xs text-muted-foreground">{t('catalog.endpoint.examplesHint')}</p>
              ) : (
                <Tabs value={activeTab} onValueChange={setExampleTab} className="gap-3">
                  <TabsList aria-label={t('catalog.endpoint.exampleResponses')} className="h-auto flex-wrap border border-line bg-surface-2">
                    {exampleStatuses.map((status) => (
                      <TabsTrigger
                        key={status}
                        value={status}
                        className={TAB}
                        aria-invalid={Boolean(errors[`example-${status}`]) || undefined}
                      >
                        {status}
                        {errors[`example-${status}`] && <AlertCircleIcon aria-hidden className="text-mismatch" />}
                      </TabsTrigger>
                    ))}
                  </TabsList>
                  {exampleStatuses.map((status) => (
                    <TabsContent key={status} value={status}>
                      <Field data-invalid={Boolean(errors[`example-${status}`])}>
                        <FieldLabel id={id(`example-${status}-label`)} className="sr-only">
                          {t('catalog.endpoint.exampleResponse', { status })}
                        </FieldLabel>
                        {!form.statuses.map(String).includes(status) && (
                          <p className="text-xs text-hazard-fg">{t('catalog.endpoint.exampleOrphan', { status })}</p>
                        )}
                        <ExampleEditor
                          value={form.examples[status] ?? ''}
                          onChange={(body) => update({ examples: { ...form.examples, [status]: body } }, [`example-${status}`])}
                          contentType={form.contentType}
                          label={t('catalog.endpoint.exampleResponse', { status })}
                          invalid={Boolean(errors[`example-${status}`])}
                          describedBy={described(`example-${status}`)}
                          size="large"
                        />
                        {fieldError(`example-${status}`)}
                      </Field>
                    </TabsContent>
                  ))}
                </Tabs>
              )}
            </FieldSet>
          </FieldGroup>
        </Section>

        <Section title={t('catalog.endpoint.section.about')}>
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
                      className="min-w-0 flex-1 font-mono"
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
        </Section>

        <div className="sticky bottom-0 z-10 -mx-1 flex flex-wrap items-center justify-end gap-2 border-t border-line bg-canvas/85 px-1 py-3 backdrop-blur">
          <Button asChild variant="outline">
            <Link to="/catalog/$key" params={{ key: integration.key }}>
              {t('common.cancel')}
            </Link>
          </Button>
          <Button type="submit" disabled={upsert.isPending}>
            {upsert.isPending ? <Spinner data-icon="inline-start" /> : <SaveIcon data-icon="inline-start" />}
            {upsert.isPending ? t('catalog.saving') : t('catalog.endpoint.save')}
          </Button>
        </div>
      </form>

      <AlertDialog open={blocker.status === 'blocked'} onOpenChange={(open) => !open && blocker.reset?.()}>
        <AlertDialogContent className="glass-panel">
          <AlertDialogHeader>
            <AlertDialogTitle>{t('editor.leaveTitle')}</AlertDialogTitle>
            <AlertDialogDescription>{t('editor.leaveBody')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => blocker.reset?.()}>{t('editor.stay')}</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={() => blocker.proceed?.()}>
              {t('editor.leave')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </EditorShell>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="glow-border flex flex-col gap-4 rounded-md border border-line bg-surface p-4 sm:p-5">
      <Eyebrow>{title}</Eyebrow>
      {children}
    </section>
  )
}

/** The endpoint as testers meet it: its row in the New mock picker and the key field of the mock editor. */
function TesterPreview({ integration, form }: { integration: Integration; form: Form }) {
  const t = useT()
  const titleId = useId()
  const lookup = form.location === NO_LOOKUP ? undefined : { location: form.location, expression: form.expression.trim() || EXPRESSION_PLACEHOLDER[form.location] }
  return (
    <section aria-labelledby={titleId} className="flex flex-col gap-4 rounded-md border border-line bg-surface p-4">
      <Eyebrow id={titleId}>{t('catalog.endpoint.preview.title')}</Eyebrow>
      <div className="flex flex-col gap-1.5">
        <p className="text-[10px] tracking-[0.12em] text-muted-foreground uppercase">{t('catalog.endpoint.preview.picker')}</p>
        <div className="flex items-center gap-3 rounded-sm border border-signal/40 bg-surface px-2 py-2">
          <MethodBadge method={form.method} className="w-14 justify-center" />
          <span className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className={form.name.trim() ? 'truncate text-sm font-medium' : 'truncate text-sm text-muted-foreground italic'}>
              {form.name.trim() || t('catalog.endpoint.preview.untitled')}
            </span>
            <span dir="ltr" className="truncate font-mono text-[11px] text-muted-foreground">
              {prefixOf(integration) && <span>{prefixOf(integration)}</span>}
              <span>{form.path}</span>
            </span>
          </span>
        </div>
      </div>
      <div className="flex flex-col gap-1.5">
        <p className="text-[10px] tracking-[0.12em] text-muted-foreground uppercase">{t('catalog.endpoint.preview.keyField')}</p>
        {lookup ? (
          <div className="flex flex-col gap-1.5">
            <span className="text-sm font-medium">{keyLabel(t, { lookup })}</span>
            <div aria-hidden className="h-8 rounded-md border border-line bg-surface-2 px-2.5 py-1.5 font-mono text-xs text-muted-foreground">
              {t('editor.keyPlaceholder')}
            </div>
            <p className="text-[11px] text-muted-foreground">{t('catalog.endpoint.preview.keyHint')}</p>
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">{t('catalog.endpoint.preview.noKey')}</p>
        )}
      </div>
    </section>
  )
}
