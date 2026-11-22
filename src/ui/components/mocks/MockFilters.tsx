import { useEffect, useRef, useState } from 'react'
import { SearchIcon, WorkflowIcon } from 'lucide-react'
import type { Integration } from '@/server/catalog/types'
import { Input } from '@/ui/components/ui/input'
import { Toggle } from '@/ui/components/ui/toggle'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/ui/components/ui/select'
import { ToggleGroup, ToggleGroupItem } from '@/ui/components/ui/toggle-group'
import { useWireMockOnly } from '@/ui/config'
import { useT } from '@/ui/i18n'

/** `scenarios: 'only'`: only mocks that belong to a scenario (the "Scenario mocks" chip). `page`: the list page, from 1. */
export type MocksSearch = { owner?: string; integration?: string; status?: string; q?: string; scenarios?: 'only'; page?: number }

/** The owner filter when the URL names none: everyone's mocks ('me' narrows to your own). */
export const DEFAULT_OWNER = 'all'

const ANY = '__any__'
const STATUSES = ['200', '201', '204', '400', '401', '403', '404', '409', '422', '500', '502', '503']
const DEBOUNCE_MS = 250
const ON = "data-[state=on]:border-signal/40 data-[state=on]:bg-signal/10 data-[state=on]:text-signal-fg"

export function MockFilters({
  search,
  integrations,
  onChange,
}: {
  search: MocksSearch
  integrations: Integration[]
  onChange: (next: MocksSearch) => void
}) {
  const t = useT()
  // WireMock-only mode has one account and WireMock's own stubs: there is no "mine" to filter by.
  const wiremockOnly = useWireMockOnly()
  const owner = search.owner ?? DEFAULT_OWNER
  const [text, setText] = useState(search.q ?? '')
  const pushed = useRef(search.q ?? '')

  // Follow the URL (Clear filters, back/forward) — but not our own echo, which would clobber keystrokes typed meanwhile …
  useEffect(() => {
    if ((search.q ?? '') === pushed.current) return
    pushed.current = search.q ?? ''
    setText(pushed.current)
  }, [search.q])
  // … and push typing to it after a pause.
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
      {!wiremockOnly && (
        <ToggleGroup
          type="single"
          variant="outline"
          size="sm"
          aria-label={t('mocks.filterOwner')}
          value={owner === 'me' || owner === 'all' ? owner : ''}
          onValueChange={(value) => value && onChange({ owner: value })}
        >
          <ToggleGroupItem value="all" className={ON}>{t('mocks.ownerAll')}</ToggleGroupItem>
          <ToggleGroupItem value="me" className={ON}>{t('mocks.ownerMe')}</ToggleGroupItem>
        </ToggleGroup>
      )}

      <div className="relative min-w-48 basis-full sm:flex-1 sm:basis-auto sm:max-w-72">
        <SearchIcon aria-hidden className="pointer-events-none absolute start-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          type="search"
          aria-label={t('mocks.search')}
          placeholder={t('mocks.searchPlaceholder')}
          className="ps-8"
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
      </div>

      <Select
        value={search.integration ?? ANY}
        onValueChange={(value) => onChange({ integration: value === ANY ? undefined : value })}
      >
        <SelectTrigger aria-label={t('mocks.integration')} className="w-52">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ANY}>{t('mocks.anyIntegration')}</SelectItem>
          {integrations.map((i) => (
            <SelectItem key={i.key} value={i.key}>
              {i.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select value={search.status ?? ANY} onValueChange={(value) => onChange({ status: value === ANY ? undefined : value })}>
        <SelectTrigger aria-label={t('mocks.status')} className="w-40">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ANY}>{t('mocks.anyStatus')}</SelectItem>
          {STATUSES.map((s) => (
            <SelectItem key={s} value={s}>
              {s}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Toggle
        variant="outline"
        size="sm"
        pressed={search.scenarios === 'only'}
        onPressedChange={(on) => onChange({ scenarios: on ? 'only' : undefined })}
        className={ON}
      >
        <WorkflowIcon />
        {t('mocks.scenarioOnly')}
      </Toggle>
    </div>
  )
}
