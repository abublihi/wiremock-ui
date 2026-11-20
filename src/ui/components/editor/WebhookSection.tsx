import { useId } from 'react'
import { Field, FieldDescription, FieldError, FieldLabel, FieldLegend, FieldSet } from '@/ui/components/ui/field'
import { Input } from '@/ui/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/ui/components/ui/select'
import { Switch } from '@/ui/components/ui/switch'
import { ToggleGroup, ToggleGroupItem } from '@/ui/components/ui/toggle-group'
import { useT } from '@/ui/i18n'
import type { WebhookDelay, WebhookForm } from '@/ui/lib/editor-sync'
import { MAX_WEBHOOK_DELAY_MS, WEBHOOK_METHODS, type WebhookMethod } from '@/ui/lib/presets'
import { CodeEditor } from './CodeEditor'
import { HeaderRows } from './HeaderRows'

export type WebhookErrors = Partial<Record<'url' | 'headers' | 'delay' | 'method' | 'body', string>>

// WireMock 3.13.1 names the incoming request `originalRequest` in a webhook template (`request` is the callback).
const TEMPLATE_EXAMPLE = "{{jsonPath originalRequest.body '$.id'}}"
const DELAYS: { value: WebhookDelay; label: 'editor.webhook.delay.none' | 'editor.webhook.delay.fixed' | 'editor.webhook.delay.uniform' }[] = [
  { value: 'none', label: 'editor.webhook.delay.none' },
  { value: 'fixed', label: 'editor.webhook.delay.fixed' },
  { value: 'uniform', label: 'editor.webhook.delay.uniform' },
]
const ON = 'data-[state=on]:border-signal/50 data-[state=on]:bg-signal/10 data-[state=on]:text-signal-fg'

/** "Call back after responding": a switch that opens the webhook's method, URL, headers, body and delay. */
export function WebhookSection({
  webhook,
  errors,
  onChange,
}: {
  webhook: WebhookForm
  errors: WebhookErrors
  onChange: (patch: Partial<WebhookForm>) => void
}) {
  const t = useT()
  const ids = useId()
  const id = (name: string) => `${ids}-${name}`
  const described = (name: keyof WebhookErrors, hint?: string) => [hint, errors[name] && id(`${name}-error`)].filter(Boolean).join(' ') || undefined
  const error = (name: keyof WebhookErrors) => (errors[name] ? <FieldError id={id(`${name}-error`)}>{errors[name]}</FieldError> : null)
  const ms = (value: number) => (Number.isNaN(value) ? '' : value)
  const toMs = (text: string) => (text === '' ? Number.NaN : Number(text))

  return (
    <div className="flex flex-col gap-5">
      <Field orientation="horizontal">
        <Switch id={id('on')} checked={webhook.enabled} aria-controls={webhook.enabled ? id('fields') : undefined} onCheckedChange={(enabled) => onChange({ enabled })} />
        <div className="flex flex-col gap-0.5">
          <FieldLabel htmlFor={id('on')}>{t('editor.webhook.toggle')}</FieldLabel>
          <FieldDescription className="text-xs">{t('editor.webhook.toggleHint')}</FieldDescription>
        </div>
      </Field>

      {webhook.enabled && (
        <div id={id('fields')} className="fade-up flex flex-col gap-5 border-s-2 border-signal/30 ps-4">
          <div className="grid gap-5 sm:grid-cols-[8rem_1fr]">
            <Field data-invalid={Boolean(errors.method)}>
              <FieldLabel htmlFor={id('method')}>{t('editor.webhook.method')}</FieldLabel>
              <Select value={webhook.method} onValueChange={(method) => onChange({ method: method as WebhookMethod })}>
                <SelectTrigger id={id('method')} className="w-full font-mono" aria-invalid={Boolean(errors.method)} aria-describedby={described('method')}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {WEBHOOK_METHODS.map((m) => (
                    <SelectItem key={m} value={m} className="font-mono">
                      {m}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {error('method')}
            </Field>
            <Field data-invalid={Boolean(errors.url)}>
              <FieldLabel htmlFor={id('url')}>{t('editor.webhook.url')}</FieldLabel>
              <Input
                id={id('url')}
                type="url"
                inputMode="url"
                dir="ltr"
                className="font-mono"
                autoComplete="off"
                spellCheck={false}
                placeholder="https://service.example/callback"
                value={webhook.url}
                aria-invalid={Boolean(errors.url)}
                aria-describedby={described('url')}
                onChange={(e) => onChange({ url: e.target.value })}
              />
              {error('url')}
            </Field>
          </div>

          <Field data-invalid={Boolean(errors.headers)}>
            <span className="text-sm font-medium">{t('editor.webhook.headers')}</span>
            <HeaderRows
              label={t('editor.webhook.headers')}
              rows={webhook.headers}
              invalid={Boolean(errors.headers)}
              describedBy={described('headers')}
              onChange={(headers) => onChange({ headers })}
            />
            {error('headers')}
          </Field>

          <Field data-invalid={Boolean(errors.body)}>
            <span className="text-sm font-medium">{t('editor.webhook.body')}</span>
            <CodeEditor
              value={webhook.body}
              language="json"
              label={t('editor.webhook.body')}
              invalid={Boolean(errors.body)}
              describedBy={described('body', id('body-hint'))}
              maxHeight="16rem"
              onChange={(body) => onChange({ body })}
            />
            <FieldDescription id={id('body-hint')} className="text-xs">
              {t('editor.webhook.bodyHint', { example: TEMPLATE_EXAMPLE })}
            </FieldDescription>
            {error('body')}
          </Field>

          <FieldSet className="gap-2" data-invalid={Boolean(errors.delay)}>
            <FieldLegend variant="label" id={id('delay-label')}>
              {t('editor.webhook.delay')}
            </FieldLegend>
            <ToggleGroup
              type="single"
              variant="outline"
              size="sm"
              spacing={1}
              aria-labelledby={id('delay-label')}
              value={webhook.delay}
              onValueChange={(v) => v && onChange({ delay: v as WebhookDelay })}
              className="flex-wrap"
            >
              {DELAYS.map((d) => (
                <ToggleGroupItem key={d.value} value={d.value} className={ON}>
                  {t(d.label)}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
            {webhook.delay !== 'none' && (
              <div className="flex flex-wrap items-end gap-3">
                {(webhook.delay === 'fixed'
                  ? ([['delayMs', 'editor.webhook.delayMs']] as const)
                  : ([
                      ['lower', 'editor.webhook.lower'],
                      ['upper', 'editor.webhook.upper'],
                    ] as const)
                ).map(([key, label]) => (
                  <Field key={key} className="w-36">
                    <FieldLabel htmlFor={id(key)} className="text-xs">
                      {t(label)}
                    </FieldLabel>
                    <Input
                      id={id(key)}
                      type="number"
                      inputMode="numeric"
                      min={0}
                      max={MAX_WEBHOOK_DELAY_MS}
                      className="font-mono"
                      value={ms(webhook[key])}
                      aria-invalid={Boolean(errors.delay)}
                      aria-describedby={described('delay', id('delay-hint'))}
                      onChange={(e) => onChange({ [key]: toMs(e.target.value) })}
                    />
                  </Field>
                ))}
                <span id={id('delay-hint')} className="pb-2 text-xs text-muted-foreground">
                  {t('editor.webhook.delayRange')}
                </span>
              </div>
            )}
            {error('delay')}
          </FieldSet>
        </div>
      )}
    </div>
  )
}
