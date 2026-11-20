import { AlertCircleIcon, BracesIcon, ExternalLinkIcon } from 'lucide-react'
import type { Endpoint, Integration } from '@/server/catalog/types'
import { useEndpoints, useIntegrations } from '@/ui/api/queries'
import { MethodBadge } from '@/ui/components/common/MethodBadge'
import { Alert, AlertDescription, AlertTitle } from '@/ui/components/ui/alert'
import { Button } from '@/ui/components/ui/button'
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/ui/components/ui/command'
import { Skeleton } from '@/ui/components/ui/skeleton'
import { useT } from '@/ui/i18n'
import { Eyebrow } from './EditorShell'

/** Every search word must appear somewhere in the item (cmdk's fuzzy default matches too loosely for paths). */
function filter(value: string, search: string, keywords?: string[]): number {
  const haystack = [value, ...(keywords ?? [])].join(' ').toLowerCase()
  return search
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((word) => haystack.includes(word))
    ? 1
    : 0
}

const prefixOf = (integration: Integration) => (integration.prefix === '/' ? '' : integration.prefix)

/** A searchable list of catalog endpoints grouped by integration, with a way out to a blank free-form stub. */
export function EndpointPicker({
  onPick,
  onBlank,
}: {
  onPick: (integration: string, endpoint: string) => void
  onBlank?: () => void
}) {
  const t = useT()
  const integrations = useIntegrations()

  const blank = onBlank && (
    <p className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
      <Button variant="link" size="sm" className="h-auto px-0" onClick={onBlank}>
        <BracesIcon data-icon="inline-start" />
        {t('editor.blank')}
      </Button>
      <span>{t('editor.blankHint')}</span>
    </p>
  )
  if (integrations.isError) {
    return (
      <div className="flex flex-col gap-3">
        <Alert variant="destructive">
          <AlertCircleIcon />
          <AlertTitle>{t('editor.pickLoadFailed')}</AlertTitle>
          <AlertDescription>{integrations.error.message}</AlertDescription>
        </Alert>
        {blank}
      </div>
    )
  }
  return (
    <section aria-labelledby="pick-title" className="flex flex-col gap-2">
      <Eyebrow id="pick-title">{t('editor.pickTitle')}</Eyebrow>
      <Command label={t('editor.pickSearch')} filter={filter} className="rounded-md border border-line bg-surface p-1">
        <CommandInput placeholder={t('editor.pickPlaceholder')} autoFocus />
        <CommandList className="max-h-[min(32rem,60vh)]">
          {integrations.isPending ? (
            <div className="flex flex-col gap-2 p-2">
              {Array.from({ length: 4 }, (_, i) => (
                <Skeleton key={i} className="h-9 w-full" />
              ))}
            </div>
          ) : integrations.data.length === 0 ? (
            <p className="px-3 py-6 text-center text-xs text-muted-foreground">{t('editor.pickNoCatalog')}</p>
          ) : (
            <>
              <CommandEmpty className="py-6 text-center text-xs text-muted-foreground">{t('editor.pickEmpty')}</CommandEmpty>
              {integrations.data.map((integration) => (
                <IntegrationGroup key={integration.key} integration={integration} onPick={onPick} />
              ))}
            </>
          )}
        </CommandList>
      </Command>
      {blank}
    </section>
  )
}

function IntegrationGroup({ integration, onPick }: { integration: Integration; onPick: (integration: string, endpoint: string) => void }) {
  const t = useT()
  const endpoints = useEndpoints(integration.key)
  return (
    <CommandGroup
      heading={integration.name}
      className="**:[[cmdk-group-heading]]:text-[10px] **:[[cmdk-group-heading]]:tracking-[0.16em] **:[[cmdk-group-heading]]:uppercase"
    >
      {endpoints.isPending && <Skeleton className="m-1 h-9" />}
      {endpoints.data?.map((endpoint) => (
        <CommandItem
          key={endpoint.key}
          value={`${integration.key}/${endpoint.key}`}
          keywords={[integration.name, endpoint.name, endpoint.method, prefixOf(integration) + endpoint.path]}
          onSelect={() => onPick(integration.key, endpoint.key)}
          className="flex items-center gap-3 py-2 data-[selected=true]:bg-signal/10"
        >
          <MethodBadge method={endpoint.method} className="w-14 justify-center" />
          <span className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="truncate font-medium">{endpoint.name}</span>
            <span dir="ltr" className="truncate font-mono text-[11px] text-muted-foreground">
              <span className="opacity-70">{prefixOf(integration)}</span>
              <span>{endpoint.path}</span>
            </span>
          </span>
          <span className="hidden text-[10px] text-muted-foreground sm:inline">
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
