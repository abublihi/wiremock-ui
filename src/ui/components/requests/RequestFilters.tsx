import { useEffect, useRef, useState } from 'react'
import { SearchIcon } from 'lucide-react'
import type { Integration } from '@/server/catalog/types'
import { Input } from '@/ui/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/ui/components/ui/select'
import { ToggleGroup, ToggleGroupItem } from '@/ui/components/ui/toggle-group'
import { useT } from '@/ui/i18n'

/** The request log's URL state: filters, time range and the open request. */
export type RequestsSearch = {
  integration?: string
  matched?: 'true' | 'false'
  status?: string
  q?: string
  range?: '15m' | '1h'
  open?: string
}

const ANY = '__any__'
const ALL = 'all'
const STATUSES = ['200', '201', '204', '400', '401', '403', '404', '409', '422', '500', '502', '503', '504']
const DEBOUNCE_MS = 250
const ON = 'data-[state=on]:border-signal/40 data-[state=on]:bg-signal/10 data-[state=on]:text-signal-fg'
const HAZARD_ON = 'data-[state=on]:border-hazard/50 data-[state=on]:bg-hazard/10 data-[state=on]:text-hazard-fg'

export function RequestFilters({
  search,
  integrations,
  onChange,
}: {
  search: RequestsSearch
  integrations: Integration[]
  onChange: (next: RequestsSearch) => void
}) {
  const t = useT()
  const [text, setText] = useState(search.q ?? '')
  const pushed = useRef(search.q ?? '')

  // Follow the URL (Clear filters, back/forward) but not our own echo; push typing after a pause.
  useEffect(() => {
    if ((search.q ?? '') === pushed.current) return
    pushed.current = search.q ?? ''
    setText(pushed.current)
  }, [search.q])
  useEffect(() => {
    if (text === pushed.current) return
    const timer = setTimeout(() => {
      pushed.current = text
      onChange({ q: text || undefined })
    }, DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [text, onChange])

  return (
    <div className="flex flex-wrap items-center gap-2">
      <ToggleGroup
        type="single"
        variant="outline"
        size="sm"
        aria-label={t('requests.filterResult')}
        value={search.matched ?? ALL}
        onValueChange={(value) => value && onChange({ matched: value === ALL ? undefined : (value as 'true' | 'false') })}
      >
        <ToggleGroupItem value={ALL} className={ON}>
          {t('requests.resultAll')}
        </ToggleGroupItem>
        <ToggleGroupItem value="true" className={ON}>
          {t('requests.resultMatched')}
        </ToggleGroupItem>
        <ToggleGroupItem value="false" className={HAZARD_ON}>
          {t('requests.resultNoMatch')}
        </ToggleGroupItem>
      </ToggleGroup>

      <div className="relative min-w-48 basis-full sm:max-w-72 sm:flex-1 sm:basis-auto">
        <SearchIcon aria-hidden className="pointer-events-none absolute start-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          type="search"
          aria-label={t('requests.search')}
          placeholder={t('requests.searchPlaceholder')}
          className="ps-8"
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
      </div>

      <Select value={search.integration ?? ANY} onValueChange={(value) => onChange({ integration: value === ANY ? undefined : value })}>
        <SelectTrigger aria-label={t('requests.integration')} className="w-52">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ANY}>{t('requests.anyIntegration')}</SelectItem>
          {integrations.map((i) => (
            <SelectItem key={i.key} value={i.key}>
              {i.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select value={search.status ?? ANY} onValueChange={(value) => onChange({ status: value === ANY ? undefined : value })}>
        <SelectTrigger aria-label={t('requests.status')} className="w-40">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ANY}>{t('requests.anyStatus')}</SelectItem>
          {STATUSES.map((s) => (
            <SelectItem key={s} value={s}>
              {s}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <ToggleGroup
        type="single"
        variant="outline"
        size="sm"
        aria-label={t('requests.range')}
        value={search.range ?? ALL}
        onValueChange={(value) => value && onChange({ range: value === ALL ? undefined : (value as '15m' | '1h') })}
      >
        <ToggleGroupItem value="15m" className={ON}>
          {t('requests.range15m')}
        </ToggleGroupItem>
        <ToggleGroupItem value="1h" className={ON}>
          {t('requests.range1h')}
        </ToggleGroupItem>
        <ToggleGroupItem value={ALL} className={ON}>
          {t('requests.rangeAll')}
        </ToggleGroupItem>
      </ToggleGroup>
    </div>
  )
}
