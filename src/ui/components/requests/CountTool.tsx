import { useId, useState } from 'react'
import { HashIcon } from 'lucide-react'
import { useCountRequests } from '@/ui/api/queries'
import { Button } from '@/ui/components/ui/button'
import { Field, FieldGroup, FieldLabel } from '@/ui/components/ui/field'
import { Input } from '@/ui/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/ui/components/ui/popover'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/ui/components/ui/select'
import { Spinner } from '@/ui/components/ui/spinner'
import { useT } from '@/ui/i18n'

const METHODS = ['ANY', 'GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const

/** "How many times was this called?": method + URL path → WireMock's request count. */
export function CountTool() {
  const t = useT()
  const ids = { title: useId(), method: useId(), path: useId() }
  const [method, setMethod] = useState<string>('GET')
  const [path, setPath] = useState('')
  const count = useCountRequests()

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    const urlPath = path.trim()
    if (!urlPath) return
    count.mutate({ method, urlPath: urlPath.startsWith('/') ? urlPath : `/${urlPath}` })
  }

  return (
    <Popover onOpenChange={(open) => !open && count.reset()}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm">
          <HashIcon data-icon="inline-start" />
          {t('count.open')}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" aria-labelledby={ids.title} className="glass-panel w-80 gap-3 p-3">
        <div>
          <h2 id={ids.title} className="text-xs font-semibold">
            {t('count.title')}
          </h2>
          <p className="text-[11px] text-muted-foreground">{t('count.caption')}</p>
        </div>
        <form onSubmit={submit} className="flex flex-col gap-3">
          <FieldGroup className="flex-row gap-2">
            <Field className="w-28 shrink-0">
              <FieldLabel htmlFor={ids.method} className="text-[11px]">
                {t('count.method')}
              </FieldLabel>
              <Select value={method} onValueChange={setMethod}>
                <SelectTrigger id={ids.method} className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {METHODS.map((m) => (
                    <SelectItem key={m} value={m}>
                      {m === 'ANY' ? t('count.anyMethod') : m}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field className="min-w-0">
              <FieldLabel htmlFor={ids.path} className="text-[11px]">
                {t('count.path')}
              </FieldLabel>
              <Input
                id={ids.path}
                dir="ltr"
                className="h-8 font-mono text-xs"
                placeholder="/blog/posts/42"
                value={path}
                aria-describedby={`${ids.path}-hint`}
                onChange={(e) => setPath(e.target.value)}
              />
              <p id={`${ids.path}-hint`} className="text-[11px] text-muted-foreground">
                {t('count.pathHint')}
              </p>
            </Field>
          </FieldGroup>
          <div className="flex items-center justify-between gap-3">
            <p role="status" className="min-w-0 text-xs">
              {count.isSuccess && (
                <span className="font-display text-lg font-bold text-signal-fg">
                  {t(count.data.count === 1 ? 'count.resultOne' : 'count.result', { count: count.data.count })}
                </span>
              )}
              {count.isError && <span className="text-mismatch">{t('count.failed', { message: count.error.message })}</span>}
            </p>
            <Button type="submit" size="sm" disabled={!path.trim() || count.isPending}>
              {count.isPending && <Spinner data-icon="inline-start" />}
              {t('count.submit')}
            </Button>
          </div>
        </form>
      </PopoverContent>
    </Popover>
  )
}
