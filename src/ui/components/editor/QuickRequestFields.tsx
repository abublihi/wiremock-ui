import { useId, useState } from 'react'
import { Field, FieldDescription, FieldError, FieldLabel, FieldLegend, FieldSet } from '@/ui/components/ui/field'
import { Input } from '@/ui/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/ui/components/ui/select'
import { Textarea } from '@/ui/components/ui/textarea'
import { ToggleGroup, ToggleGroupItem } from '@/ui/components/ui/toggle-group'
import { useT } from '@/ui/i18n'
import { QUICK_METHODS, QUICK_URL_TYPES, isPriority, isRegex, type QuickMethod, type QuickRequest, type QuickUrlType } from '@/ui/lib/editor-sync'
import { HeaderRows, hasUnnamedRow } from './HeaderRows'

export type QuickErrors = Partial<Record<'url' | 'query' | 'priority', string>>

/**
 * A full URL typed or pasted where a path goes (https://api.example.com/blog/posts?page=2): its path, and its query as
 * rows. Null for anything that is not an http(s) URL with a host.
 */
export function splitFullUrl(text: string): { path: string; query: { name: string; value: string }[] } | null {
  const trimmed = text.trim()
  if (!/^https?:\/\/[^/\s]+/i.test(trimmed)) return null
  try {
    const url = new URL(trimmed)
    const path = decodeURI(url.pathname) || '/'
    return { path, query: [...url.searchParams].map(([name, value]) => ({ name, value })) }
  } catch {
    return null
  }
}

const ON = 'data-[state=on]:border-signal/50 data-[state=on]:bg-signal/10 data-[state=on]:text-signal-fg'

/** The quick form's own checks (the server's builder has the same rules); required ones wait for a save attempt. */
export function quickRequestErrors(t: ReturnType<typeof useT>, quick: QuickRequest, attempted: boolean): QuickErrors {
  const out: QuickErrors = {}
  const url = quick.url.trim()
  if (url === '') {
    if (attempted) out.url = t('editor.quick.urlRequired')
  } else if (/\s/.test(url)) out.url = t('editor.quick.urlSpaces')
  else if (quick.urlType !== 'regex' && !url.startsWith('/')) out.url = t('editor.quick.urlSlash')
  else if (quick.urlType !== 'regex' && url.includes('?')) out.url = t('editor.quick.urlQuery')
  else if (quick.urlType === 'regex' && !isRegex(url)) out.url = t('editor.quick.urlRegex')
  if (hasUnnamedRow(quick.query)) out.query = t('editor.quick.queryUnnamed')
  const priority = quick.priority.trim()
  if (priority !== '' && !(/^\d+$/.test(priority) && isPriority(Number(priority)))) out.priority = t('editor.quick.priorityInvalid')
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
  onChange: (patch: Partial<QuickRequest>, clears: ('url' | 'query' | 'priority')[]) => void
}) {
  const t = useT()
  const ids = useId()
  const id = (name: string) => `${ids}-${name}`
  const described = (name: keyof QuickErrors, hint?: string) => [hint, errors[name] && id(`${name}-error`)].filter(Boolean).join(' ') || undefined
  const error = (name: keyof QuickErrors) => (errors[name] ? <FieldError id={id(`${name}-error`)}>{errors[name]}</FieldError> : null)
  const [pasted, setPasted] = useState<{ url: string; query: boolean } | null>(null)
  // On leaving the field (not while typing): a full URL becomes its path, and its query moves to the rows.
  const takePath = () => {
    const value = quick.url
    const full = quick.urlType === 'regex' ? null : splitFullUrl(value)
    if (!full) return
    setPasted({ url: value.trim(), query: full.query.length > 0 })
    const rows = quick.query.filter((r) => r.name.trim() !== '' || r.value !== '')
    onChange({ url: full.path, ...(full.query.length > 0 ? { query: [...rows, ...full.query] } : {}) }, ['url', 'query'])
  }

  return (
    <>
      <div className="grid gap-4 sm:grid-cols-[9rem_minmax(0,1fr)]">
        <Field>
          <FieldLabel htmlFor={id('method')}>{t('editor.quick.method')}</FieldLabel>
          <Select value={quick.method} onValueChange={(method) => onChange({ method: method as QuickMethod }, [])}>
            <SelectTrigger id={id('method')} className="w-full font-mono">
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
            onChange={(e) => {
              setPasted(null)
              onChange({ url: e.target.value }, ['url'])
            }}
            onBlur={takePath}
          />
          {pasted && (
            <p role="status" className="text-xs text-muted-foreground">
              {t(pasted.query ? 'editor.quick.pastedUrlQuery' : 'editor.quick.pastedUrl', { url: pasted.url })}
            </p>
          )}
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

      <Field>
        <FieldLabel htmlFor={id('body')}>
          {t('editor.quick.bodyMatch')} <span className="font-normal text-muted-foreground">({t('editor.nameOptional')})</span>
        </FieldLabel>
        <Textarea
          id={id('body')}
          dir="ltr"
          rows={3}
          className="font-mono text-xs md:text-xs"
          spellCheck={false}
          placeholder='{"userId": 7}'
          value={quick.body}
          aria-describedby={id('body-hint')}
          onChange={(e) => onChange({ body: e.target.value }, [])}
        />
        <FieldDescription id={id('body-hint')} className="text-xs">
          {t('editor.quick.bodyMatchHint')}
        </FieldDescription>
      </Field>

      <Field data-invalid={Boolean(errors.priority)}>
        <FieldLabel htmlFor={id('priority')}>
          {t('editor.quick.priority')} <span className="font-normal text-muted-foreground">({t('editor.nameOptional')})</span>
        </FieldLabel>
        <Input
          id={id('priority')}
          dir="ltr"
          inputMode="numeric"
          autoComplete="off"
          className="font-mono sm:max-w-32"
          placeholder="5"
          value={quick.priority}
          aria-invalid={Boolean(errors.priority)}
          aria-describedby={described('priority', id('priority-hint'))}
          onChange={(e) => onChange({ priority: e.target.value }, ['priority'])}
        />
        <FieldDescription id={id('priority-hint')} className="text-xs">
          {t('editor.quick.priorityHint')}
        </FieldDescription>
        {error('priority')}
      </Field>
    </>
  )
}
