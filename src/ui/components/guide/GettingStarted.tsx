import { useEffect, useSyncExternalStore } from 'react'
import { Link } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { ArrowRightIcon, CheckIcon, CircleIcon, XIcon } from 'lucide-react'
import { apiFetch } from '@/ui/api/client'
import { queryKeys, useSession } from '@/ui/api/queries'
import { Button } from '@/ui/components/ui/button'
import { useWireMockOnly, useWiremockPublicUrl } from '@/ui/config'
import { useT, type MessageKey } from '@/ui/i18n'
import { type ChecklistFlag, checklistKey } from '@/ui/lib/guide'
import { cn } from '@/ui/lib/utils'

// ── Per-browser, per-user flags (localStorage), safe when storage is blocked and on the server ─────────────────────────────

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

/**
 * A remembered yes/no for this browser and the signed-in user; `serverValue` is what the server render (and the first
 * paint, and the moment before the session is known) uses.
 */
export function useFlag(flag: ChecklistFlag, userId: string | undefined, serverValue: boolean): boolean {
  return useSyncExternalStore(
    subscribeFlags,
    () => (userId === undefined ? serverValue : readFlag(checklistKey(flag, userId))),
    () => serverValue,
  )
}

/** The signed-in user's id: the checklist's flags are kept per user. */
export function useChecklistUser(): string | undefined {
  return useSession().data?.user.id
}

/** Shows the checklist on the Mocks page again (the Guide's "Show the Getting started checklist"). */
export function reopenChecklist(userId: string | undefined): void {
  if (userId === undefined) return
  setFlag(checklistKey('done', userId), false)
  setFlag(checklistKey('dismissed', userId), false)
}

/** The request log calls this once it has shown a request: the checklist's last step. */
export function markRequestLogSeen(userId: string | undefined): void {
  if (userId === undefined) return
  const key = checklistKey('requestLogSeen', userId)
  if (!readFlag(key)) setFlag(key, true)
}

// ── The checklist ───────────────────────────────────────────────────────────────────────────────────────────────

type Step = { id: string; label: MessageKey; hint: MessageKey; done: boolean; to: string; search?: Record<string, string>; action: MessageKey }

/**
 * First-run "Getting started" on the Mocks page: three steps from a first mock to the request log, each ticked from
 * real data (a mock exists, WireMock has received a request, the request log was opened). Dismissed per browser and user; the Guide shows it again.
 */
export function GettingStartedChecklist() {
  const t = useT()
  // Server render and first paint: hidden, so a dismissed checklist never flashes.
  // Hidden (and asking the server nothing) once dismissed or once every step is done.
  const userId = useChecklistUser()
  const dismissed = useFlag('dismissed', userId, true)
  const finished = useFlag('done', userId, true)
  const hidden = dismissed || finished
  const seenLog = useFlag('requestLogSeen', userId, false)
  const sent = useFlag('requestSent', userId, false)
  // WireMock-only mode has no owners: every mock counts.
  const wiremockOnly = useWireMockOnly()
  const user = useSession().data?.user.username
  const me = wiremockOnly ? undefined : user
  const publicUrl = useWiremockPublicUrl() ?? 'WireMock'
  // The mock step counts the user's own mocks: someone new on a busy install still has that step to do.
  const mocks = useQuery({
    queryKey: [...queryKeys.mocks, 'any', me],
    queryFn: async () => (await apiFetch<{ totalMocks: number }>('/api/mocks', { query: { limit: 1, offset: 0, owner: me } })).totalMocks,
    enabled: !hidden && (wiremockOnly || me !== undefined),
  })
  const requests = useQuery({
    queryKey: [...queryKeys.requests, 'any'],
    queryFn: async () => (await apiFetch<unknown[]>('/api/requests', { query: { limit: 1 } })).length,
    enabled: !hidden && !sent,
    refetchInterval: 15_000,
    refetchIntervalInBackground: false,
  })
  const hasRequest = sent || (requests.data ?? 0) > 0
  useEffect(() => {
    if (hasRequest && !sent && userId) setFlag(checklistKey('requestSent', userId), true)
  }, [hasRequest, sent, userId])
  const doneNow = (mocks.data ?? 0) > 0 && hasRequest && seenLog
  useEffect(() => {
    if (doneNow && !hidden && userId) setFlag(checklistKey('done', userId), true)
  }, [doneNow, hidden, userId])
  if (hidden) return null

  const steps: Step[] = [
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
            onClick={() => userId && setFlag(checklistKey('dismissed', userId), true)}
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
      <ol className="mt-3 grid gap-2 sm:grid-cols-3">
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
              <span className="text-xs text-muted-foreground">{t(step.hint, { url: publicUrl })}</span>
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
