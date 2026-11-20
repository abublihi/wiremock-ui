import { useId } from 'react'
import { Field, FieldDescription, FieldError, FieldLabel, FieldLegend, FieldSet } from '@/ui/components/ui/field'
import { Input } from '@/ui/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/ui/components/ui/select'
import { Textarea } from '@/ui/components/ui/textarea'
import { ToggleGroup, ToggleGroupItem } from '@/ui/components/ui/toggle-group'
import { useT } from '@/ui/i18n'
import { QUICK_METHODS, QUICK_URL_TYPES, type QuickMethod, type QuickRequest, type QuickUrlType } from '@/ui/lib/editor-sync'
import { HeaderRows, hasUnnamedRow } from './HeaderRows'

export type QuickErrors = Partial<Record<'method' | 'url' | 'query' | 'body', string>>

const ON = 'data-[state=on]:border-signal/50 data-[state=on]:bg-signal/10 data-[state=on]:text-signal-fg'

/** The quick form's own checks (the server's builder has the same rules); required ones wait for a save attempt. */
export function quickRequestErrors(t: ReturnType<typeof useT>, quick: QuickRequest, attempted: boolean): { url?: string; query?: string } {
  const out: { url?: string; query?: string } = {}
  const url = quick.url.trim()
  if (url === '') {
    if (attempted) out.url = t('editor.quick.urlRequired')
  } else if (/\s/.test(url)) out.url = t('editor.quick.urlSpaces')
  else if (quick.urlType !== 'regex' && !url.startsWith('/')) out.url = t('editor.quick.urlSlash')
  else if (quick.urlType !== 'regex' && url.includes('?')) out.url = t('editor.quick.urlQuery')
  if (hasUnnamedRow(quick.query)) out.query = t('editor.quick.queryUnnamed')
  return out
}

/** "Mock a URL directly": the request a quick mock answers — method, URL (path, template or regex), query and body to match. */
export function QuickRequestFields({
  quick,
  errors,
  onChange,
}: {
  quick: QuickRequest
  errors: QuickErrors
  onChange: (patch: Partial<QuickRequest>, clears: ('method' | 'url' | 'query' | 'bodyMatch')[]) => void
}) {
  const t = useT()
  const ids = useId()
  const id = (name: string) => `${ids}-${name}`
  const described = (name: keyof QuickErrors, hint?: string) => [hint, errors[name] && id(`${name}-error`)].filter(Boolean).join(' ') || undefined
  const error = (name: keyof QuickErrors) => (errors[name] ? <FieldError id={id(`${name}-error`)}>{errors[name]}</FieldError> : null)

  return (
    <>
      <div className="grid gap-4 sm:grid-cols-[9rem_minmax(0,1fr)]">
        <Field data-invalid={Boolean(errors.method)}>
          <FieldLabel htmlFor={id('method')}>{t('editor.quick.method')}</FieldLabel>
          <Select value={quick.method} onValueChange={(method) => onChange({ method: method as QuickMethod }, ['method'])}>
            <SelectTrigger id={id('method')} className="w-full font-mono" aria-invalid={Boolean(errors.method)} aria-describedby={described('method')}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {QUICK_METHODS.map((m) => (
                <SelectItem key={m} value={m} className="font-mono">
                  {m}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {error('method')}
        </Field>

        <Field data-invalid={Boolean(errors.url)}>
          <FieldLabel htmlFor={id('url')}>{t('editor.quick.url')}</FieldLabel>
          <Input
            id={id('url')}
            dir="ltr"
            className="font-mono"
            autoComplete="off"
            spellCheck={false}
            placeholder={t(`editor.quick.urlPlaceholder.${quick.urlType}`)}
            value={quick.url}
            aria-invalid={Boolean(errors.url)}
            aria-describedby={described('url', id('url-hint'))}
            onChange={(e) => onChange({ url: e.target.value }, ['url'])}
          />
          {error('url')}
        </Field>
      </div>

      <FieldSet className="gap-2">
        <FieldLegend variant="label" id={id('type-label')}>
          {t('editor.quick.urlType')}
        </FieldLegend>
        <ToggleGroup
          type="single"
          variant="outline"
          size="sm"
          spacing={1}
          aria-labelledby={id('type-label')}
          aria-describedby={id('url-hint')}
          value={quick.urlType}
          onValueChange={(v) => v && onChange({ urlType: v as QuickUrlType }, ['url'])}
          className="flex-wrap"
        >
          {QUICK_URL_TYPES.map((type) => (
            <ToggleGroupItem key={type} value={type} className={ON}>
              {t(`editor.quick.urlType.${type}`)}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        <FieldDescription id={id('url-hint')} className="text-xs">
          {t(`editor.quick.urlHint.${quick.urlType}`)}
        </FieldDescription>
      </FieldSet>

      <Field data-invalid={Boolean(errors.query)}>
        <FieldLabel id={id('query-label')}>
          {t('editor.quick.query')} <span className="font-normal text-muted-foreground">({t('editor.nameOptional')})</span>
        </FieldLabel>
        <HeaderRows
          label={t('editor.quick.query')}
          rows={quick.query}
          addLabel={t('editor.quick.queryAdd')}
          invalid={Boolean(errors.query)}
          describedBy={described('query', id('query-hint'))}
          onChange={(query) => onChange({ query }, ['query'])}
        />
        <FieldDescription id={id('query-hint')} className="text-xs">
          {t('editor.quick.queryHint')}
        </FieldDescription>
        {error('query')}
      </Field>

      <Field data-invalid={Boolean(errors.body)}>
        <FieldLabel htmlFor={id('body')}>
          {t('editor.quick.bodyMatch')} <span className="font-normal text-muted-foreground">({t('editor.nameOptional')})</span>
        </FieldLabel>
        <Textarea
          id={id('body')}
          dir="ltr"
          rows={3}
          className="font-mono text-xs md:text-xs"
          spellCheck={false}
          placeholder='{"idNo": "1012345678"}'
          value={quick.body}
          aria-invalid={Boolean(errors.body)}
          aria-describedby={described('body', id('body-hint'))}
          onChange={(e) => onChange({ body: e.target.value }, ['bodyMatch'])}
        />
        <FieldDescription id={id('body-hint')} className="text-xs">
          {t('editor.quick.bodyMatchHint')}
        </FieldDescription>
        {error('body')}
      </Field>
    </>
  )
}
