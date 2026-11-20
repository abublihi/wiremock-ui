import { useState } from 'react'
import { useQueries } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { AlertCircleIcon, BracesIcon, ExternalLinkIcon, LinkIcon, PlusIcon } from 'lucide-react'
import type { Endpoint, Integration } from '@/server/catalog/types'
import { endpointsQueryOptions, useIntegrations } from '@/ui/api/queries'
import type { ScenarioReturn } from '@/ui/components/catalog/EndpointPage'
import { MethodBadge } from '@/ui/components/common/MethodBadge'
import { Alert, AlertDescription, AlertTitle } from '@/ui/components/ui/alert'
import { Button } from '@/ui/components/ui/button'
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/ui/components/ui/command'
import { Skeleton } from '@/ui/components/ui/skeleton'
import { useT } from '@/ui/i18n'
import { Eyebrow } from './EditorShell'

/** The most endpoints the picker renders at once; typing narrows the rest. */
export const PICKER_LIMIT = 50

const prefixOf = (integration: Integration) => (integration.prefix === '/' ? '' : integration.prefix)

/** Every search word must appear somewhere in the endpoint (integration, name, method, key or full path). */
export function matchesSearch(integration: Integration, endpoint: Endpoint, search: string): boolean {
  const haystack = [integration.key, endpoint.key, integration.name, endpoint.name, endpoint.method, prefixOf(integration) + endpoint.path]
    .join(' ')
    .toLowerCase()
  return search
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((word) => haystack.includes(word))
}

/**
 * A searchable list of catalog endpoints grouped by integration, with ways out to a quick URL mock and a blank
 * free-form stub. Shows at most PICKER_LIMIT matches (a footer says how many more there are); an integration without
 * endpoints shows "No endpoints yet — Add one" instead of an empty heading (while not searching).
 */
export function EndpointPicker({
  onPick,
  onBlank,
  onQuick,
  addReturnsHere,
}: {
  onPick: (integration: string, endpoint: string) => void
  onBlank?: () => void
  /** "Not in the list? Mock a URL directly". */
  onQuick?: () => void
  /** Set: "Add one" comes back to the new-mock page with the new endpoint picked, keeping this scenario context. */
  addReturnsHere?: ScenarioReturn
}) {
  const t = useT()
  const integrations = useIntegrations()
  const [search, setSearch] = useState('')
  const endpointLists = useQueries({
    queries: (integrations.data ?? []).map((integration) => endpointsQueryOptions(integration.key)),
  })
  const loading = endpointLists.some((q) => q.isPending)
  const failed = endpointLists.find((q) => q.isError)?.error

  // The matches, in catalog order, cut at PICKER_LIMIT and grouped by integration (empty groups dropped). Cheap
  // enough to redo each render: a thousand endpoints filter in well under a millisecond.
  const { groups, shown, total } = (() => {
    const out: { integration: Integration; endpoints: Endpoint[] }[] = []
    let count = 0
    let all = 0
    ;(integrations.data ?? []).forEach((integration, i) => {
      const matches = (endpointLists[i]?.data ?? []).filter((endpoint) => matchesSearch(integration, endpoint, search))
      all += matches.length
      const room = Math.max(0, PICKER_LIMIT - count)
      if (room > 0 && matches.length > 0) {
        out.push({ integration, endpoints: matches.slice(0, room) })
        count += Math.min(room, matches.length)
      }
    })
    return { groups: out, shown: count, total: all }
  })()
  // Integrations whose (loaded) endpoint list is empty: offered an "Add one" link instead of an empty heading.
  const empty = search ? [] : (integrations.data ?? []).filter((_, i) => endpointLists[i]?.data?.length === 0)

  // Only integrations without endpoints (and no search): their "Add one" rows replace the (empty) list.
  const onlyEmpty = !loading && search === '' && total === 0 && empty.length > 0

  const quick = onQuick && (
    <p className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
      <span>{t('editor.pickNotListed')}</span>
      <Button variant="link" size="sm" className="h-auto px-0 text-signal-fg" onClick={onQuick}>
        <LinkIcon data-icon="inline-start" />
        {t('editor.mockUrl')}
      </Button>
      <span>{t('editor.mockUrlHint')}</span>
    </p>
  )
  const blank = onBlank && (
    <p className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
      <Button variant="link" size="sm" className="h-auto px-0" onClick={onBlank}>
        <BracesIcon data-icon="inline-start" />
        {t('editor.blank')}
      </Button>
      <span>{t('editor.blankHint')}</span>
    </p>
  )
  const error = integrations.error ?? failed
  if (error) {
    return (
      <div className="flex flex-col gap-3">
        <Alert variant="destructive">
          <AlertCircleIcon />
          <AlertTitle>{t('editor.pickLoadFailed')}</AlertTitle>
          <AlertDescription>{error.message}</AlertDescription>
        </Alert>
        {quick}
        {blank}
      </div>
    )
  }
  return (
    <section aria-labelledby="pick-title" className="flex flex-col gap-2">
      <Eyebrow id="pick-title">{t('editor.pickTitle')}</Eyebrow>
      {onlyEmpty ? (
        // Nothing to pick or search yet: no search box and no (empty) listbox, only a way to add the first endpoint.
        <div className="rounded-md border border-line bg-surface p-1">
          {empty.map((integration) => (
            <EmptyIntegration key={integration.key} integration={integration} returnHere={addReturnsHere} />
          ))}
        </div>
      ) : (
        /* Matching and the cap happen here, so cmdk only renders (and moves the selection over) what is shown. */
        <Command label={t('editor.pickSearch')} shouldFilter={false} className="rounded-md border border-line bg-surface p-1">
          <CommandInput placeholder={t('editor.pickPlaceholder')} value={search} onValueChange={setSearch} autoFocus />
          <CommandList className="max-h-[min(32rem,60vh)]">
            {integrations.data === undefined ? (
              <PickerSkeleton />
            ) : integrations.data.length === 0 ? (
              <p className="px-3 py-6 text-center text-xs text-muted-foreground">{t('editor.pickNoIntegrations')}</p>
            ) : (
              <>
                {!loading && <CommandEmpty className="py-6 text-center text-xs text-muted-foreground">{t('editor.pickEmpty')}</CommandEmpty>}
                {groups.map(({ integration, endpoints }) => (
                  <IntegrationGroup key={integration.key} integration={integration} endpoints={endpoints} onPick={onPick} />
                ))}
                {loading && <Skeleton className="m-1 h-9" />}
              </>
            )}
          </CommandList>
          {/* Outside the listbox: these are links, not options. Tab reaches them; arrow keys stay on the endpoints. */}
          {empty.length > 0 && (
            <div className="mt-1 border-t border-line pt-1">
              {empty.map((integration) => (
                <EmptyIntegration key={integration.key} integration={integration} returnHere={addReturnsHere} />
              ))}
            </div>
          )}
          {!loading && total > shown && (
            <p role="status" className="border-t border-line px-3 py-2 text-xs text-muted-foreground">
              {t('editor.pickCapped', { shown: shown.toLocaleString('en'), total: total.toLocaleString('en') })}
            </p>
          )}
        </Command>
      )}
      {quick}
      {blank}
    </section>
  )
}

/** An integration with no endpoints yet: its name and a way to add the first one. */
function EmptyIntegration({ integration, returnHere }: { integration: Integration; returnHere?: ScenarioReturn }) {
  const t = useT()
  return (
    <div role="group" aria-label={integration.name} className="overflow-hidden p-1 text-foreground">
      <p aria-hidden className="px-2 py-1.5 text-[11px] font-medium tracking-[0.16em] text-muted-foreground uppercase">
        {integration.name}
      </p>
      <p className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-sm border border-dashed border-line px-2 py-2 text-xs text-muted-foreground">
        <span>{t('editor.pickNoEndpointsYet')}</span>
        <span aria-hidden>—</span>
        <Link
          to="/integrations/$key/endpoints/new"
          params={{ key: integration.key }}
          search={returnHere ? { next: 'mock', ...returnHere } : {}}
          aria-label={t('editor.pickAddOneTo', { name: integration.name })}
          className="inline-flex items-center gap-1 text-signal-fg hover:underline"
        >
          <PlusIcon aria-hidden className="size-3" />
          {t('editor.pickAddOne')}
        </Link>
      </p>
    </div>
  )
}

function PickerSkeleton() {
  return (
    <div className="flex flex-col gap-2 p-2">
      {Array.from({ length: 4 }, (_, i) => (
        <Skeleton key={i} className="h-9 w-full" />
      ))}
    </div>
  )
}

function IntegrationGroup({
  integration,
  endpoints,
  onPick,
}: {
  integration: Integration
  endpoints: Endpoint[]
  onPick: (integration: string, endpoint: string) => void
}) {
  const t = useT()
  return (
    <CommandGroup
      heading={integration.name}
      className="**:[[cmdk-group-heading]]:text-[11px] **:[[cmdk-group-heading]]:tracking-[0.16em] **:[[cmdk-group-heading]]:uppercase"
    >
      {endpoints.map((endpoint) => (
        <CommandItem
          key={endpoint.key}
          value={`${integration.key}/${endpoint.key}`}
          onSelect={() => onPick(integration.key, endpoint.key)}
          className="flex items-center gap-3 py-2 data-[selected=true]:bg-signal/10"
        >
          <MethodBadge method={endpoint.method} className="w-14 justify-center" />
          <span className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="truncate font-medium">{endpoint.name}</span>
            <span dir="ltr" className="truncate font-mono text-xs text-muted-foreground">
              <span className="opacity-70">{prefixOf(integration)}</span>
              <span>{endpoint.path}</span>
            </span>
          </span>
          <span className="hidden text-[11px] text-muted-foreground sm:inline">
            {t('editor.endpointRef', { integration: integration.name, endpoint: endpoint.name })}
          </span>
        </CommandItem>
      ))}
    </CommandGroup>
  )
}

const SAFE_URL = /^https?:\/\//i

const LOOKUP_KEY = {
  jsonPath: 'editor.key.jsonPath',
  xPath: 'editor.key.xPath',
  query: 'editor.key.query',
  path: 'editor.key.path',
  header: 'editor.key.header',
  form: 'editor.key.form',
} as const

const KEY_WHERE = {
  jsonPath: 'editor.keyWhere.jsonPath',
  xPath: 'editor.keyWhere.xPath',
  query: 'editor.keyWhere.query',
  path: 'editor.keyWhere.path',
  header: 'editor.keyWhere.header',
  form: 'editor.keyWhere.form',
} as const

/** What the key is, in plain words ("Mocks of this endpoint are told apart by …"). */
export function keyExplanation(t: ReturnType<typeof useT>, endpoint: Pick<Endpoint, 'lookup'>): string {
  if (!endpoint.lookup) return t('editor.keyExplainNone')
  return t('editor.keyExplain', { where: t(KEY_WHERE[endpoint.lookup.location], { expr: endpoint.lookup.expression }) })
}

/** The label for the key value input, naming where the endpoint looks for the key. */
export function keyLabel(t: ReturnType<typeof useT>, endpoint: Pick<Endpoint, 'lookup'>): string {
  return endpoint.lookup ? t(LOOKUP_KEY[endpoint.lookup.location], { expr: endpoint.lookup.expression }) : ''
}

/** What the catalog says about the endpoint: method and URL, lookup, content type, description and links. */
export function EndpointInfo({ integration, endpoint }: { integration: Integration; endpoint: Endpoint }) {
  const t = useT()
  const links = (endpoint.links ?? []).filter((link) => SAFE_URL.test(link.url))
  return (
    <section aria-labelledby="endpoint-info" className="flex flex-col gap-3 rounded-md border border-line bg-surface p-4">
      <Eyebrow id="endpoint-info">{t('editor.aboutEndpoint')}</Eyebrow>
      <div className="flex min-w-0 items-center gap-2">
        <MethodBadge method={endpoint.method} />
        <span dir="ltr" className="min-w-0 font-mono text-xs break-all">
          <span className="text-muted-foreground">{prefixOf(integration)}</span>
          {endpoint.path}
        </span>
      </div>
      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-xs">
        <dt className="text-muted-foreground">{t('editor.lookup')}</dt>
        <dd dir="ltr" className="font-mono break-all">
          {endpoint.lookup ? `${endpoint.lookup.location}: ${endpoint.lookup.expression}` : t('editor.lookupNone')}
        </dd>
        <dt className="text-muted-foreground">{t('editor.contentType')}</dt>
        <dd className="font-mono">{endpoint.contentType}</dd>
      </dl>
      <p className="rounded-sm border-s-2 border-signal/50 bg-signal/5 px-2.5 py-1.5 text-xs leading-relaxed">{keyExplanation(t, endpoint)}</p>
      <p className="text-xs leading-relaxed whitespace-pre-line text-muted-foreground">
        {endpoint.description || t('editor.noDescription')}
      </p>
      {links.length > 0 && (
        <ul aria-label={t('editor.links')} className="flex flex-col gap-1">
          {links.map((link) => (
            <li key={link.url}>
              <a
                href={link.url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-xs text-signal-fg hover:underline"
              >
                {link.label}
                <ExternalLinkIcon aria-hidden className="size-3" />
              </a>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
