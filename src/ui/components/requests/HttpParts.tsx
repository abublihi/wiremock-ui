import { useId, type ReactNode } from 'react'
import { useT } from '@/ui/i18n'
import { parseJsonBody } from '@/ui/lib/prefill'

export type Headers = Record<string, unknown> | undefined

/** Header values as WireMock logs them: a string, a list, or `{ values: [...] }`. */
export function headerValue(value: unknown): string {
  if (Array.isArray(value)) return value.map(headerValue).join(', ')
  if (value && typeof value === 'object' && 'values' in value) return headerValue((value as { values: unknown }).values)
  return String(value ?? '')
}

/** The body as text, JSON pretty-printed. */
export function prettyBody(body: string | undefined): string | null {
  if (!body) return null
  const json = parseJsonBody(body)
  return json ? JSON.stringify(json, null, 2) : body
}

/** A titled block of the request or response (`— Request`). */
export function Part({ title, children }: { title: string; children: ReactNode }) {
  const headingId = useId()
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-2">
      <h3 id={headingId} className="text-[10px] font-semibold tracking-[0.18em] text-muted-foreground uppercase">
        <span aria-hidden>— </span>
        {title}
      </h3>
      {children}
    </section>
  )
}

export function HeaderTable({ headers }: { headers: Headers }) {
  const t = useT()
  const entries = Object.entries(headers ?? {})
  if (entries.length === 0) return <p className="text-[11px] text-muted-foreground">{t('request.noHeaders')}</p>
  return (
    <div className="overflow-hidden rounded-md border border-line">
      <table className="w-full table-fixed text-xs">
        <caption className="sr-only">{t('request.headers')}</caption>
        <colgroup>
          <col className="w-2/5" />
          <col />
        </colgroup>
        <thead className="sr-only">
          <tr>
            <th scope="col">{t('request.header')}</th>
            <th scope="col">{t('request.value')}</th>
          </tr>
        </thead>
        <tbody>
          {entries.map(([name, value]) => (
            <tr key={name} className="border-t border-line first:border-t-0">
              <th scope="row" dir="ltr" className="bg-surface-2/50 px-2.5 py-1.5 text-start align-top font-mono font-normal break-all text-muted-foreground">
                {name}
              </th>
              <td dir="ltr" className="px-2.5 py-1.5 font-mono break-all">
                {headerValue(value)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export function Body({ text }: { text: string | null }) {
  const t = useT()
  if (text === null) return <p className="text-[11px] text-muted-foreground">{t('request.noBody')}</p>
  return (
    <pre dir="ltr" aria-label={t('request.body')} className="max-h-80 overflow-auto rounded-md border border-line bg-canvas p-3 font-mono text-xs leading-relaxed whitespace-pre-wrap break-all">
      {text}
    </pre>
  )
}
