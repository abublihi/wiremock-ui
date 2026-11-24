import { useState } from 'react'
import { PlayIcon, TerminalIcon } from 'lucide-react'
import { toast } from 'sonner'
import type { StubMapping } from '@/server/wiremock/types'
import { apiFetch } from '@/ui/api/client'
import { MethodBadge } from '@/ui/components/common/MethodBadge'
import { TestPanel, copyCurl } from '@/ui/components/editor/TestPanel'
import { Button } from '@/ui/components/ui/button'
import { useWiremockPublicUrl } from '@/ui/config'
import { useT } from '@/ui/i18n'
import { curlFromStub } from '@/ui/lib/curl'
import { type StubDraft, draftFromStub } from '@/ui/lib/test-request'

/** A scenario's request, as its mocks match it (method and URL), and the mock to try it with. */
export type ScenarioRequestLine = { method?: string; url?: string; mockId: string }

/** The distinct requests of a scenario's mocks, in the order given (first mock of each). */
export function scenarioRequests(mocks: { id: string; method?: string; url?: string }[]): ScenarioRequestLine[] {
  const seen = new Map<string, ScenarioRequestLine>()
  for (const m of mocks) {
    const k = `${m.method ?? ''} ${m.url ?? ''}`
    if (!seen.has(k)) seen.set(k, { method: m.method, url: m.url, mockId: m.id })
  }
  return [...seen.values()]
}

/**
 * "Answers GET /payments/p-9", with Copy as curl and Try for that request (built from one of the scenario's mocks,
 * as the mock row menu and the editor do). `stub` skips loading the mock when the caller has it already; `toolsOnly`
 * leaves out the line when the page shows the request already.
 */
export function ScenarioRequest({ line, stub: given, toolsOnly = false }: { line: ScenarioRequestLine; stub?: StubMapping; toolsOnly?: boolean }) {
  const t = useT()
  const publicUrl = useWiremockPublicUrl()
  const [trying, setTrying] = useState<StubDraft | null>(null)
  const [busy, setBusy] = useState(false)

  const load = async () => {
    const stub = given ?? (await apiFetch<StubMapping>(`/api/mocks/${encodeURIComponent(line.mockId)}`))
    return { stub, endpoint: undefined }
  }
  // The clipboard write starts during the click (Safari needs that), with the command still being worked out.
  const onCopy = () => {
    if (publicUrl === undefined) return void copyCurl(undefined, t)
    void copyCurl(
      load().then(({ stub, endpoint }) => curlFromStub(stub, endpoint, publicUrl)),
      t,
    )
  }
  const onTry = async () => {
    setBusy(true)
    try {
      const { stub, endpoint } = await load()
      setTrying(draftFromStub(stub, endpoint))
    } catch (error) {
      toast.error(t('scenarios.tryFailed'), { description: error instanceof Error ? error.message : undefined })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
      {!toolsOnly && (
        <p className="flex min-w-0 items-center gap-2 text-sm">
          <span className="text-muted-foreground">{t('scenarios.answers')}</span>
          {line.method && <MethodBadge method={line.method} />}
          <code dir="ltr" className="min-w-0 font-mono text-xs wrap-anywhere">
            {line.url ?? t('scenarios.anyUrl')}
          </code>
        </p>
      )}
      <div className="flex items-center gap-1.5">
        <Button variant="ghost" size="xs" onClick={onCopy} aria-label={t('scenarios.copyCurlFor', { request: `${line.method ?? ''} ${line.url ?? ''}`.trim() })}>
          <TerminalIcon data-icon="inline-start" />
          {t('curl.copy')}
        </Button>
        <Button variant="ghost" size="xs" disabled={busy} onClick={() => void onTry()} aria-label={t('scenarios.tryFor', { request: `${line.method ?? ''} ${line.url ?? ''}`.trim() })}>
          <PlayIcon data-icon="inline-start" />
          {t('scenarios.try')}
        </Button>
      </div>
      {trying && (
        <TestPanel
          open
          onOpenChange={(open) => !open && setTrying(null)}
          initial={trying.draft}
          pathIsPattern={trying.pathIsPattern}
          variant="endpoint"
        />
      )}
    </div>
  )
}
