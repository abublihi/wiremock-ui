import { trimTrailingSlashes } from '@/server/url'
import { useId } from 'react'
import type { Endpoint, Integration } from '@/server/catalog/types'
import { Button } from '@/ui/components/ui/button'
import { Field, FieldDescription, FieldError, FieldLabel } from '@/ui/components/ui/field'
import { Input } from '@/ui/components/ui/input'
import { useT } from '@/ui/i18n'
import type { ProxyForm } from '@/ui/lib/editor-sync'
import { HeaderRows } from './HeaderRows'

export type ProxyErrors = Partial<Record<'baseUrl' | 'stripPrefix' | 'headers', string>>

/** Where a request to the endpoint's own path would go: `/blog/posts` → `https://real/api/posts`. */
export function proxyRoute(integration: Integration, endpoint: Endpoint, proxy: ProxyForm): { from: string; to: string } {
  const from = (integration.prefix === '/' ? '' : integration.prefix) + endpoint.path
  const prefix = proxy.stripPrefix.trim()
  const rest = prefix && from.startsWith(prefix) ? from.slice(prefix.length) : from
  return { from, to: trimTrailingSlashes(proxy.baseUrl.trim()) + rest }
}

/** "Forward to a real service": base URL, path prefix to strip, headers to add and remove. */
export function ProxySection({
  integration,
  endpoint,
  proxy,
  errors,
  onChange,
}: {
  integration: Integration
  endpoint: Endpoint
  proxy: ProxyForm
  errors: ProxyErrors
  onChange: (patch: Partial<ProxyForm>) => void
}) {
  const t = useT()
  const ids = useId()
  const id = (name: string) => `${ids}-${name}`
  const described = (name: keyof ProxyErrors, hint?: string) => [hint, errors[name] && id(`${name}-error`)].filter(Boolean).join(' ') || undefined
  const error = (name: keyof ProxyErrors) => (errors[name] ? <FieldError id={id(`${name}-error`)}>{errors[name]}</FieldError> : null)
  // The integration prefix is offered, not applied: most services don't share the mock's path layout.
  const suggestion = integration.prefix !== '/' && proxy.stripPrefix.trim() === '' ? integration.prefix : null
  const route = proxy.baseUrl.trim() ? proxyRoute(integration, endpoint, proxy) : null

  return (
    <div className="flex flex-col gap-5">
      <Field data-invalid={Boolean(errors.baseUrl)}>
        <FieldLabel htmlFor={id('base')}>{t('editor.proxy.baseUrl')}</FieldLabel>
        <Input
          id={id('base')}
          type="url"
          inputMode="url"
          dir="ltr"
          className="font-mono"
          autoComplete="off"
          spellCheck={false}
          placeholder="https://service.example/api"
          value={proxy.baseUrl}
          aria-invalid={Boolean(errors.baseUrl)}
          aria-describedby={described('baseUrl', id('base-hint'))}
          onChange={(e) => onChange({ baseUrl: e.target.value })}
          // WireMock adds the request path (which starts with /): a trailing / would double it.
          onBlur={() => proxy.baseUrl.endsWith('/') && onChange({ baseUrl: trimTrailingSlashes(proxy.baseUrl) })}
        />
        <FieldDescription id={id('base-hint')} className="text-xs">
          {t('editor.proxy.baseUrlHint')} {t('editor.dockerHint')}
        </FieldDescription>
        {error('baseUrl')}
      </Field>

      <Field data-invalid={Boolean(errors.stripPrefix)}>
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <FieldLabel htmlFor={id('strip')}>{t('editor.proxy.stripPrefix')}</FieldLabel>
          {suggestion && (
            <Button
              type="button"
              variant="link"
              size="xs"
              className="h-auto p-0 font-mono text-xs text-signal-fg"
              onClick={() => onChange({ stripPrefix: suggestion })}
            >
              {t('editor.proxy.usePrefix', { prefix: suggestion })}
            </Button>
          )}
        </div>
        <Input
          id={id('strip')}
          dir="ltr"
          className="font-mono"
          autoComplete="off"
          spellCheck={false}
          placeholder={integration.prefix !== '/' ? integration.prefix : '/v1'}
          value={proxy.stripPrefix}
          aria-invalid={Boolean(errors.stripPrefix)}
          aria-describedby={described('stripPrefix', id('strip-hint'))}
          onChange={(e) => onChange({ stripPrefix: e.target.value })}
        />
        <FieldDescription id={id('strip-hint')} className="text-xs">
          {t('editor.proxy.stripPrefixHint')}
        </FieldDescription>
        {error('stripPrefix')}
        {route && (
          <p dir="ltr" className="font-mono text-xs break-all text-muted-foreground">
            {t('editor.proxy.route', route)}
          </p>
        )}
      </Field>

      <div className="grid gap-5 sm:grid-cols-2">
        <Field data-invalid={Boolean(errors.headers)}>
          <span className="text-sm font-medium">
            {t('editor.proxy.addHeaders')}
          </span>
          <HeaderRows
            label={t('editor.proxy.addHeaders')}
            rows={proxy.addHeaders}
            invalid={Boolean(errors.headers)}
            describedBy={described('headers')}
            onChange={(addHeaders) => onChange({ addHeaders })}
          />
          {error('headers')}
        </Field>
        <Field>
          <FieldLabel htmlFor={id('remove')}>{t('editor.proxy.removeHeaders')}</FieldLabel>
          <Input
            id={id('remove')}
            dir="ltr"
            className="font-mono"
            autoComplete="off"
            spellCheck={false}
            placeholder="Authorization, Cookie"
            value={proxy.removeHeaders}
            aria-describedby={id('remove-hint')}
            onChange={(e) => onChange({ removeHeaders: e.target.value })}
          />
          <FieldDescription id={id('remove-hint')} className="text-xs">
            {t('editor.proxy.removeHeadersHint')}
          </FieldDescription>
        </Field>
      </div>

      <p className="text-xs text-muted-foreground">{t('editor.proxy.realAnswer')}</p>
    </div>
  )
}
