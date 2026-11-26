import { useId, useState } from 'react'
import { FileIcon, Trash2Icon } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/ui/components/ui/button'
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel, FieldLegend, FieldSet } from '@/ui/components/ui/field'
import { Input } from '@/ui/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/ui/components/ui/select'
import { Switch } from '@/ui/components/ui/switch'
import { Textarea } from '@/ui/components/ui/textarea'
import { ToggleGroup, ToggleGroupItem } from '@/ui/components/ui/toggle-group'
import { useT } from '@/ui/i18n'
import { type ProxyForm, type QuickRequest, type SimpleForm, type WebhookForm, QUICK_INTEGRATION, exampleFor, isHttpUrl, quickEndpoint } from '@/ui/lib/editor-sync'
import { FAULT_OPTIONS, PRESET_LABEL, SLOW_MAX_SECONDS, MAX_WEBHOOK_DELAY_MS, SLOW_MIN_SECONDS, type Preset, presetToStatus, visiblePresets } from '@/ui/lib/presets'
import { cn } from '@/ui/lib/utils'
import { type BodyFile, formatSize } from '@/ui/lib/body-file'
import { BodyFileButton } from './BodyFileButton'
import { CodeEditor } from './CodeEditor'
import { Eyebrow } from './EditorShell'
import { HeaderRows, hasUnnamedRow } from './HeaderRows'
import { ProxySection } from './ProxySection'
import { WebhookSection } from './WebhookSection'

export type FieldName =
  | 'keyValue'
  | 'url'
  | 'query'
  | 'priority'
  | 'headers'
  | 'status'
  | 'body'
  | 'delay'
  | 'fault'
  | 'name'
  | 'proxyBaseUrl'
  | 'proxyStripPrefix'
  | 'proxyHeaders'
  | 'webhookMethod'
  | 'webhookUrl'
  | 'webhookHeaders'
  | 'webhookBody'
  | 'webhookDelay'
  | 'scenarioName'
  | 'scenarioRequiredState'
  | 'scenarioNewState'
export type Errors = Partial<Record<FieldName, string>>

const NO_FAULT = 'none'
export const ON = 'data-[state=on]:border-signal/50 data-[state=on]:bg-signal/10 data-[state=on]:text-signal-fg'

/**
 * The checks the form makes on a response before saving (the server makes them too). `customText` is the custom
 * status as typed, when the response is on a custom status.
 */
export function responseClientErrors(t: ReturnType<typeof useT>, form: SimpleForm, attempted: boolean, customText?: string): Errors {
  const errors: Errors = {}
  const proxied = form.answer === 'proxy'
  const broken = !proxied && form.fault !== ''
  const timeout = !proxied && !broken && form.preset === 'timeout'
  if (!proxied && !broken && form.preset === 'custom') {
    const n = Number(customText ?? String(form.status))
    if (!Number.isInteger(n) || n < 100 || n > 599) errors.status = t('editor.statusRange')
  }
  if (form.slow && !timeout) {
    const s = form.delaySeconds
    if (!Number.isInteger(s) || s < SLOW_MIN_SECONDS || s > SLOW_MAX_SECONDS) errors.delay = t('editor.slowRange')
  }
  if (proxied) {
    const { baseUrl, stripPrefix, addHeaders } = form.proxy
    if ((attempted || baseUrl.trim() !== '') && !isHttpUrl(baseUrl)) errors.proxyBaseUrl = t('editor.proxy.baseUrlInvalid')
    if (stripPrefix.trim() !== '' && !stripPrefix.trim().startsWith('/')) errors.proxyStripPrefix = t('editor.proxy.stripPrefixInvalid')
    if (hasUnnamedRow(addHeaders)) errors.proxyHeaders = t('editor.headers.unnamed')
  }
  if (form.webhook.enabled) {
    const { url, headers, delay, delayMs, lower, upper } = form.webhook
    if ((attempted || url.trim() !== '') && !isHttpUrl(url, { templated: true })) errors.webhookUrl = t('editor.webhook.urlInvalid')
    if (hasUnnamedRow(headers)) errors.webhookHeaders = t('editor.headers.unnamed')
    const inRange = (n: number) => Number.isInteger(n) && n >= 0 && n <= MAX_WEBHOOK_DELAY_MS
    if (delay === 'fixed' && !inRange(delayMs)) errors.webhookDelay = t('editor.webhook.delayRange')
    if (delay === 'uniform') {
      if (!inRange(lower) || !inRange(upper)) errors.webhookDelay = t('editor.webhook.delayRange')
      else if (lower > upper) errors.webhookDelay = t('editor.webhook.delayOrder')
    }
  }
  if (!proxied && !broken && form.quick && hasUnnamedRow(form.quick.responseHeaders)) errors.headers = t('editor.headers.unnamed')
  return errors
}

/** Whether a response still has something to fix before saving (with the required URLs flagged). */
export const responseBlocked = (t: ReturnType<typeof useT>, form: SimpleForm) =>
  Object.keys(responseClientErrors(t, form, true)).length > 0 ||
  (form.answer === 'proxy' && !isHttpUrl(form.proxy.baseUrl)) ||
  (form.webhook.enabled && !isHttpUrl(form.webhook.url, { templated: true }))

/**
 * One response of a mock, as the Simple editor edits it: what to answer with (a mock response or forwarding), the
 * status, headers and body, the behaviour (slow, broken connection) and the call back. The main response and each
 * extra response of a mock with several responses use it alike. `request` is the mock's request (the status presets
 * and body language follow it); `onChange` gets a patch and the server errors it clears.
 */
export function ResponseFields({
  form,
  request,
  serverErrors = {},
  attempted,
  onChange,
  compact = false,
}: {
  form: SimpleForm
  request: QuickRequest
  serverErrors?: Errors
  attempted: boolean
  onChange: (patch: Partial<SimpleForm>, clears: FieldName[]) => void
  /** Inside a response card: the parts as plain blocks instead of their own sections. */
  compact?: boolean
}) {
  const t = useT()
  const ids = useId()
  const id = (name: string) => `${ids}-${name}`
  const endpoint = quickEndpoint({ ...request, responseHeaders: form.quick!.responseHeaders })
  const [bodyTouched, setBodyTouched] = useState(true)
  const [exampleStatus, setExampleStatus] = useState(form.status)
  const [customText, setCustomText] = useState(String(form.status))
  const [fileError, setFileError] = useState<string | null>(null)

  const presets = visiblePresets(endpoint.allowedStatuses)
  const covered = new Set(presets.map((p) => presetToStatus(p).status))
  const showCustom = form.preset === 'custom' || endpoint.allowedStatuses.length === 0 || endpoint.allowedStatuses.some((s) => !covered.has(s))
  const proxied = form.answer === 'proxy'
  const broken = !proxied && form.fault !== ''
  const timeout = !proxied && !broken && form.preset === 'timeout'
  const errors: Errors = { ...serverErrors, ...responseClientErrors(t, form, attempted, customText) }
  const responseHeaders = form.quick!.responseHeaders

  const updateProxy = (patch: Partial<ProxyForm>) => onChange({ proxy: { ...form.proxy, ...patch } }, ['proxyBaseUrl', 'proxyStripPrefix', 'proxyHeaders'])
  const updateWebhook = (patch: Partial<WebhookForm>) =>
    onChange({ webhook: { ...form.webhook, ...patch } }, ['webhookMethod', 'webhookUrl', 'webhookHeaders', 'webhookBody', 'webhookDelay'])
  const setHeaders = (rows: QuickRequest['responseHeaders'], clears: FieldName[], patch: Partial<SimpleForm> = {}) =>
    onChange({ ...patch, quick: { ...form.quick!, responseHeaders: rows } }, clears)
  /** A preset always swaps in its example (or none); a typed custom status only when there is one. */
  const setStatus = (preset: Preset, status: number, keepWithoutExample = false) => {
    const example = exampleFor(endpoint, status)
    const refill = !bodyTouched && (example !== '' || !keepWithoutExample)
    if (refill) setExampleStatus(status)
    onChange({ preset, status, ...(refill ? { body: example } : {}) }, ['status', 'body'])
  }
  /** A text file becomes the body; anything else a binary body with its own Content-Type. */
  const onBodyFile = (file: BodyFile) => {
    setBodyTouched(true)
    if (file.kind === 'text') onChange({ body: file.text, binary: null }, ['body'])
    else {
      const binary = { base64: file.base64, name: file.name, size: file.size, contentType: file.contentType }
      // A typed Content-Type gives way to the file's own.
      setHeaders(
        responseHeaders.filter((r) => r.name.trim().toLowerCase() !== 'content-type'),
        ['body', 'headers'],
        { body: '', binary },
      )
    }
    toast.success(t('editor.bodyFile.loaded', { name: file.name }))
  }
  const onPreset = (value: string) => {
    if (!value) return // the toggle group allows deselecting; a status is always chosen
    const preset = value as Preset
    if (preset === 'custom') {
      setCustomText(String(form.status))
      onChange({ preset }, ['status'])
    } else setStatus(preset, presetToStatus(preset).status)
  }
  const onCustom = (text: string) => {
    setCustomText(text)
    const n = Number(text)
    if (text !== '' && Number.isInteger(n)) setStatus('custom', n, true)
  }

  const described = (field: FieldName, ...extra: (string | false)[]) => [...extra, errors[field] && id(`${field}-error`)].filter(Boolean).join(' ') || undefined
  const fieldError = (field: FieldName) => (errors[field] ? <FieldError id={id(`${field}-error`)}>{errors[field]}</FieldError> : null)
  const bodyLanguage = endpoint.contentType === 'json' || endpoint.contentType === 'xml' ? endpoint.contentType : null
  const Part = compact ? CompactPart : Section

  return (
    <>
      <Part title={t('editor.section.respond')}>
        <FieldSet className="gap-2">
          <FieldLegend variant="label" id={id('answer-label')}>
            {t('editor.answer')}
          </FieldLegend>
          <ToggleGroup
            type="single"
            variant="outline"
            size="sm"
            spacing={1}
            aria-labelledby={id('answer-label')}
            value={form.answer}
            onValueChange={(v) => v && onChange({ answer: v as SimpleForm['answer'] }, ['status', 'body', 'fault', 'delay'])}
            className="flex-wrap"
          >
            <ToggleGroupItem value="mock" className={ON}>
              {t('editor.answer.mock')}
            </ToggleGroupItem>
            <ToggleGroupItem value="proxy" className={ON}>
              {t('editor.answer.proxy')}
            </ToggleGroupItem>
          </ToggleGroup>
        </FieldSet>

        {proxied ? (
          <ProxySection
            integration={QUICK_INTEGRATION}
            endpoint={endpoint}
            proxy={form.proxy}
            errors={{ baseUrl: errors.proxyBaseUrl, stripPrefix: errors.proxyStripPrefix, headers: errors.proxyHeaders }}
            onChange={updateProxy}
          />
        ) : (
          <>
            <FieldSet disabled={broken} className="gap-2">
              <FieldLegend variant="label" id={id('status-label')}>
                {t('editor.status')}
              </FieldLegend>
              <ToggleGroup
                type="single"
                variant="outline"
                size="sm"
                spacing={1}
                aria-labelledby={id('status-label')}
                aria-describedby={described('status', timeout && id('timeout-hint'))}
                disabled={broken}
                value={form.preset}
                onValueChange={onPreset}
                className="flex-wrap"
              >
                {presets.map((preset) => (
                  <ToggleGroupItem key={preset} value={preset} aria-label={`${t(PRESET_LABEL[preset])} ${presetToStatus(preset).status}`} className={cn('gap-1.5', ON)}>
                    {t(PRESET_LABEL[preset])}
                    <span aria-hidden className="font-mono text-[11px] opacity-60">
                      {presetToStatus(preset).status}
                    </span>
                  </ToggleGroupItem>
                ))}
                {showCustom && (
                  <ToggleGroupItem value="custom" aria-label={t(PRESET_LABEL.custom)} className={ON}>
                    {t(PRESET_LABEL.custom)}
                  </ToggleGroupItem>
                )}
              </ToggleGroup>
              {timeout && (
                <FieldDescription id={id('timeout-hint')} className="text-xs">
                  {t('editor.timeoutHint')}
                </FieldDescription>
              )}
              {form.preset === 'custom' && !broken && (
                <Field data-invalid={Boolean(errors.status)} className="max-w-48">
                  <FieldLabel htmlFor={id('custom')} className="sr-only">
                    {t('editor.customStatus')}
                  </FieldLabel>
                  <Input
                    id={id('custom')}
                    type="number"
                    inputMode="numeric"
                    min={100}
                    max={599}
                    className="font-mono"
                    value={customText}
                    aria-invalid={Boolean(errors.status)}
                    aria-describedby={described('status')}
                    onChange={(e) => onCustom(e.target.value)}
                  />
                </Field>
              )}
              {fieldError('status')}
            </FieldSet>

            {!broken && (
              <Field data-invalid={Boolean(errors.headers)}>
                <FieldLabel id={id('headers-label')}>{t('editor.quick.responseHeaders')}</FieldLabel>
                <HeaderRows
                  label={t('editor.quick.responseHeaders')}
                  rows={responseHeaders}
                  invalid={Boolean(errors.headers)}
                  describedBy={described('headers', id('headers-hint'))}
                  onChange={(rows) => setHeaders(rows, ['headers', 'body'])}
                />
                <FieldDescription id={id('headers-hint')} className="text-xs">
                  {form.binary ? t('editor.quick.headersBinaryHint', { type: form.binary.contentType }) : t('editor.quick.headersHint')}
                </FieldDescription>
                {fieldError('headers')}
              </Field>
            )}

            <Field data-invalid={Boolean(errors.body)}>
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                {bodyLanguage ? (
                  <span id={id('body-label')} className="text-sm font-medium">
                    {t('editor.body')}
                  </span>
                ) : (
                  <FieldLabel htmlFor={id('body')}>{t('editor.body')}</FieldLabel>
                )}
                <span className="flex flex-wrap items-center gap-2">
                  {!broken && !bodyTouched && form.body !== '' && (
                    <span className="text-xs text-muted-foreground">{t('editor.bodyFromExample', { status: exampleStatus })}</span>
                  )}
                  {!broken && !form.binary && <BodyFileButton onFile={onBodyFile} onError={setFileError} />}
                </span>
              </div>
              {!broken && form.binary ? (
                <div role="group" aria-label={t('editor.bodyFile.binary')} className="flex flex-wrap items-center gap-3 rounded-md border border-line bg-surface-2 px-3 py-2.5">
                  <FileIcon aria-hidden className="size-4 shrink-0 text-signal-fg" />
                  <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="text-[11px] tracking-[0.14em] text-muted-foreground uppercase">{t('editor.bodyFile.binary')}</span>
                    <span dir="ltr" className="font-mono text-xs [overflow-wrap:anywhere]">
                      {form.binary.name
                        ? t('editor.bodyFile.binaryDetails', { name: form.binary.name, size: formatSize(form.binary.size), type: form.binary.contentType })
                        : t('editor.bodyFile.binaryDetailsNoName', { size: formatSize(form.binary.size), type: form.binary.contentType })}
                    </span>
                  </div>
                  <span className="flex items-center gap-1.5">
                    <BodyFileButton label={t('editor.bodyFile.replace')} onFile={onBodyFile} onError={setFileError} />
                    <Button type="button" variant="ghost" size="xs" onClick={() => onChange({ binary: null, body: '' }, ['body'])}>
                      <Trash2Icon data-icon="inline-start" />
                      {t('editor.bodyFile.remove')}
                    </Button>
                  </span>
                </div>
              ) : bodyLanguage ? (
                <CodeEditor
                  value={broken ? '' : form.body}
                  language={bodyLanguage}
                  label={t('editor.body')}
                  readOnly={broken}
                  invalid={Boolean(errors.body)}
                  describedBy={described('body', broken && id('body-hint'))}
                  maxHeight="28rem"
                  onChange={(body) => {
                    setBodyTouched(true)
                    onChange({ body }, ['body'])
                  }}
                />
              ) : (
                <Textarea
                  id={id('body')}
                  dir="ltr"
                  className="min-h-48 font-mono text-xs md:text-xs"
                  spellCheck={false}
                  disabled={broken}
                  value={broken ? '' : form.body}
                  aria-invalid={Boolean(errors.body)}
                  aria-describedby={described('body', broken && id('body-hint'))}
                  onChange={(e) => {
                    setBodyTouched(true)
                    onChange({ body: e.target.value }, ['body'])
                  }}
                />
              )}
              {broken && (
                <FieldDescription id={id('body-hint')} className="text-xs">
                  {t('editor.bodyDisabled')}
                </FieldDescription>
              )}
              {fileError && (
                <p role="alert" className="text-xs text-mismatch">
                  {fileError}
                </p>
              )}
              {fieldError('body')}
            </Field>
          </>
        )}
      </Part>

      <Part title={t('editor.section.behaviour')}>
        <div className="grid gap-5 sm:grid-cols-2">
          <Field data-invalid={Boolean(errors.delay)}>
            <div className="flex items-center gap-3">
              <Switch
                id={id('slow')}
                checked={form.slow && !timeout}
                disabled={timeout}
                aria-describedby={timeout ? id('slow-hint') : undefined}
                onCheckedChange={(slow) => onChange({ slow }, ['delay'])}
              />
              <FieldLabel htmlFor={id('slow')}>{t('editor.slow')}</FieldLabel>
            </div>
            {timeout && (
              <FieldDescription id={id('slow-hint')} className="text-xs">
                {t('editor.slowTimeout')}
              </FieldDescription>
            )}
            {form.slow && !timeout && (
              <div className="flex items-center gap-2">
                <Input
                  id={id('seconds')}
                  type="number"
                  inputMode="numeric"
                  min={SLOW_MIN_SECONDS}
                  max={SLOW_MAX_SECONDS}
                  className="w-24 font-mono"
                  aria-label={t('editor.slowSeconds')}
                  aria-invalid={Boolean(errors.delay)}
                  aria-describedby={described('delay', id('seconds-hint'))}
                  value={Number.isNaN(form.delaySeconds) ? '' : form.delaySeconds}
                  onChange={(e) => onChange({ delaySeconds: e.target.value === '' ? Number.NaN : Number(e.target.value) }, ['delay'])}
                />
                <span id={id('seconds-hint')} className="text-xs text-muted-foreground">
                  s · {t('editor.slowRange')}
                </span>
              </div>
            )}
            {fieldError('delay')}
          </Field>

          <Field data-invalid={Boolean(errors.fault)}>
            <FieldLabel htmlFor={id('fault')}>{t('editor.fault')}</FieldLabel>
            <Select
              value={proxied ? NO_FAULT : form.fault || NO_FAULT}
              disabled={proxied}
              onValueChange={(v) => onChange({ fault: v === NO_FAULT ? '' : (v as SimpleForm['fault']) }, ['fault', 'status', 'body'])}
            >
              <SelectTrigger id={id('fault')} className="w-full" aria-invalid={Boolean(errors.fault)} aria-describedby={described('fault', proxied && id('fault-hint'))}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_FAULT}>{t('editor.fault.none')}</SelectItem>
                {FAULT_OPTIONS.map((fault) => (
                  <SelectItem key={fault.value} value={fault.value}>
                    {t(fault.label)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {proxied && (
              <FieldDescription id={id('fault-hint')} className="text-xs">
                {t('editor.proxy.noFault')}
              </FieldDescription>
            )}
            {fieldError('fault')}
          </Field>
        </div>
      </Part>

      <Part title={t('editor.section.callback')}>
        <WebhookSection
          webhook={form.webhook}
          errors={{ method: errors.webhookMethod, url: errors.webhookUrl, headers: errors.webhookHeaders, body: errors.webhookBody, delay: errors.webhookDelay }}
          onChange={updateWebhook}
        />
      </Part>
    </>
  )
}

export function Section({ title, children, className }: { title: string; children: React.ReactNode; className?: string }) {
  return (
    <section className={cn('glow-border flex flex-col gap-4 rounded-md border border-line bg-surface p-4 sm:p-5', className)}>
      <Eyebrow>{title}</Eyebrow>
      <FieldGroup className="gap-5">{children}</FieldGroup>
    </section>
  )
}

/** A part of a response inside a response card: a heading and its fields, no box of its own. */
function CompactPart({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-4 border-t border-line pt-4 first:border-t-0 first:pt-0">
      <Eyebrow>{title}</Eyebrow>
      <FieldGroup className="gap-5">{children}</FieldGroup>
    </div>
  )
}
