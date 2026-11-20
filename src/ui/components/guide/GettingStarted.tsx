import { useSyncExternalStore } from 'react'
import { Link } from '@tanstack/react-router'
import { useQueries, useQuery } from '@tanstack/react-query'
import { ArrowRightIcon, CheckIcon, CircleIcon, XIcon } from 'lucide-react'
import { apiFetch } from '@/ui/api/client'
import { endpointsQueryOptions, queryKeys, useIntegrations } from '@/ui/api/queries'
import { Button } from '@/ui/components/ui/button'
import { useT, type MessageKey } from '@/ui/i18n'
import { CHECKLIST_DISMISSED_KEY, REQUEST_LOG_SEEN_KEY } from '@/ui/lib/guide'
import { cn } from '@/ui/lib/utils'

// ── Per-browser flags (localStorage), safe when storage is blocked and on the server ─────────────────────────────

const FLAG_EVENT = 'wmui-flag-change'

function readFlag(key: string): boolean {
  try {
    return window.localStorage.getItem(key) === '1'
  } catch {
    return false
  }
}

export function setFlag(key: string, on: boolean): void {
  try {
    if (on) window.localStorage.setItem(key, '1')
    else window.localStorage.removeItem(key)
  } catch {
    // Storage blocked: the flag only lives until the page reloads (the event below still updates the UI).
  }
  window.dispatchEvent(new Event(FLAG_EVENT))
}

function subscribeFlags(onChange: () => void) {
  window.addEventListener(FLAG_EVENT, onChange)
  window.addEventListener('storage', onChange)
  return () => {
    window.removeEventListener(FLAG_EVENT, onChange)
    window.removeEventListener('storage', onChange)
  }
}

/** A remembered yes/no for this browser; `serverValue` is what the server render (and the first paint) uses. */
export function useFlag(key: string, serverValue: boolean): boolean {
  return useSyncExternalStore(
    subscribeFlags,
    () => readFlag(key),
    () => serverValue,
  )
}

/** Shows the checklist on the Mocks page again (the Guide's "Show the Getting started checklist"). */
export function reopenChecklist(): void {
  setFlag(CHECKLIST_DISMISSED_KEY, false)
}

/** The request log calls this when it opens: the checklist's last step. */
export function markRequestLogSeen(): void {
  if (!readFlag(REQUEST_LOG_SEEN_KEY)) setFlag(REQUEST_LOG_SEEN_KEY, true)
}

// ── The checklist ───────────────────────────────────────────────────────────────────────────────────────────────

type Step = { id: string; label: MessageKey; hint: MessageKey; done: boolean; to: string; search?: Record<string, string>; action: MessageKey }

/** How many integrations' endpoint lists the checklist looks at (it only needs one that has an endpoint). */
const ENDPOINT_PROBE = 10

/**
 * First-run "Getting started" on the Mocks page: five steps from an integration to the request log, each ticked from
 * real data (an integration exists, an endpoint exists, a mock exists, WireMock has received a request, the request
 * log was opened). Dismissed per browser; the Guide shows it again.
 */
export function GettingStartedChecklist() {
  const t = useT()
  // Server render and first paint: hidden, so a dismissed checklist never flashes.
  const dismissed = useFlag(CHECKLIST_DISMISSED_KEY, true)
  const seenLog = useFlag(REQUEST_LOG_SEEN_KEY, false)
  const integrations = useIntegrations()
  const probe = (integrations.data ?? []).slice(0, ENDPOINT_PROBE)
  const endpoints = useQueries({
    queries: probe.map((i) => ({ ...endpointsQueryOptions(i.key), enabled: !dismissed })),
  })
  const mocks = useQuery({
    queryKey: [...queryKeys.mocks, 'any'],
    queryFn: async () => (await apiFetch<{ totalMocks: number }>('/api/mocks', { query: { limit: 1, offset: 0 } })).totalMocks,
    enabled: !dismissed,
  })
  const requests = useQuery({
    queryKey: [...queryKeys.requests, 'any'],
    queryFn: async () => (await apiFetch<unknown[]>('/api/requests', { query: { limit: 1 } })).length,
    enabled: !dismissed,
    // Until the first request arrives; after that the step stays ticked.
    refetchInterval: (q) => (q.state.data ? false : 15_000),
    refetchIntervalInBackground: false,
  })
  if (dismissed) return null

  const firstIntegration = integrations.data?.[0]?.key
  const hasRequest = (requests.data ?? 0) > 0
  const steps: Step[] = [
    {
      id: 'integration',
      label: 'checklist.integration',
      hint: 'checklist.integrationHint',
      done: (integrations.data?.length ?? 0) > 0,
      to: '/integrations',
      action: 'checklist.integrationAction',
    },
    {
      id: 'endpoint',
      label: 'checklist.endpoint',
      hint: 'checklist.endpointHint',
      done: endpoints.some((q) => (q.data?.length ?? 0) > 0),
      to: firstIntegration ? `/integrations/${encodeURIComponent(firstIntegration)}` : '/integrations',
      action: 'checklist.endpointAction',
    },
    {
      id: 'mock',
      label: 'checklist.mock',
      hint: 'checklist.mockHint',
      done: (mocks.data ?? 0) > 0,
      to: '/mocks/new',
      action: 'checklist.mockAction',
    },
    {
      id: 'request',
      label: 'checklist.request',
      hint: 'checklist.requestHint',
      done: hasRequest,
      to: '/guide',
      action: 'checklist.requestAction',
    },
    {
      id: 'log',
      label: 'checklist.log',
      hint: 'checklist.logHint',
      done: hasRequest && seenLog,
      to: '/requests',
      action: 'checklist.logAction',
    },
  ]
  const doneCount = steps.filter((s) => s.done).length
  const next = steps.find((s) => !s.done)
  const allDone = doneCount === steps.length

  return (
    <section
      aria-labelledby="getting-started-title"
      className="rounded-md border border-signal/30 bg-surface/80 p-4 backdrop-blur-sm"
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p aria-hidden className="font-mono text-[11px] tracking-[0.18em] text-signal-fg uppercase">
            // {t('checklist.eyebrow', { done: doneCount, total: steps.length })}
          </p>
          <h2 id="getting-started-title" className="font-display text-xl font-semibold tracking-wide uppercase">
            {allDone ? t('checklist.doneTitle') : t('checklist.title')}
          </h2>
          <p className="text-xs text-muted-foreground">{allDone ? t('checklist.doneBody') : t('checklist.body')}</p>
        </div>
        <div className="flex items-center gap-1">
          <Button asChild variant="ghost" size="xs">
            <Link to="/guide" hash="getting-started">
              {t('checklist.openGuide')}
            </Link>
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={t('checklist.dismiss')}
            title={t('checklist.dismiss')}
            onClick={() => setFlag(CHECKLIST_DISMISSED_KEY, true)}
          >
            <XIcon />
          </Button>
        </div>
      </div>
      <div
        role="progressbar"
        aria-label={t('checklist.progress')}
        aria-valuemin={0}
        aria-valuemax={steps.length}
        aria-valuenow={doneCount}
        className="mt-3 h-1 overflow-hidden rounded-full bg-surface-2"
      >
        <div className="h-full bg-signal transition-[width] duration-300" style={{ width: `${(doneCount / steps.length) * 100}%` }} />
      </div>
      <ol className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-5">
        {steps.map((step, i) => {
          const current = step === next
          return (
            <li
              key={step.id}
              data-done={step.done || undefined}
              className={cn(
                'flex flex-col gap-1 rounded-md border px-3 py-2 text-xs',
                step.done ? 'border-line/60 text-muted-foreground' : current ? 'border-signal/50 bg-signal/5' : 'border-line',
              )}
            >
              <span className="flex items-center gap-2 font-medium">
                {step.done ? (
                  <CheckIcon aria-hidden className="size-3.5 shrink-0 text-match" />
                ) : (
                  <CircleIcon aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
                )}
                <span className={cn(step.done && 'line-through decoration-muted-foreground/50')}>
                  {i + 1}. {t(step.label)}
                </span>
                <span className="sr-only">{step.done ? t('checklist.stepDone') : t('checklist.stepTodo')}</span>
              </span>
              <span className="text-xs text-muted-foreground">{t(step.hint)}</span>
              {!step.done && (
                <Link
                  to={step.to as '/'}
                  hash={step.id === 'request' ? 'testing' : undefined}
                  className="mt-auto inline-flex items-center gap-1 text-xs font-medium text-signal-fg hover:underline"
                >
                  {t(step.action)}
                  <ArrowRightIcon aria-hidden className="size-3" />
                </Link>
              )}
            </li>
          )
        })}
      </ol>
    </section>
  )
}
