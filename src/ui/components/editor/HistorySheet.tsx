import { useState } from 'react'
import { AlertCircleIcon, HistoryIcon, RotateCcwIcon } from 'lucide-react'
import { toast } from 'sonner'
import type { StubMapping } from '@/server/wiremock/types'
import { useMockHistory, useRestoreMock } from '@/ui/api/queries'
import { Alert, AlertDescription, AlertTitle } from '@/ui/components/ui/alert'
import { Button } from '@/ui/components/ui/button'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from '@/ui/components/ui/sheet'
import { Skeleton } from '@/ui/components/ui/skeleton'
import { Spinner } from '@/ui/components/ui/spinner'
import { useT } from '@/ui/i18n'
import { isValidDate, relativeTime } from '@/ui/lib/time'
import { cn } from '@/ui/lib/utils'
import { CodeEditor } from './CodeEditor'
import { Eyebrow } from './EditorShell'

const versionOf = (stub: StubMapping) => stub.metadata?.wiremockUi?.version ?? 0

/** Earlier versions of a mock: pick one to read its JSON, then restore it as the new live version. */
export function HistorySheet({ id, onRestored }: { id: string; onRestored: (stub: StubMapping) => void }) {
  const t = useT()
  const [open, setOpen] = useState(false)
  const [selected, setSelected] = useState<number | null>(null)
  const history = useMockHistory(id, { enabled: open })
  const restore = useRestoreMock()
  const chosen = history.data?.find((v) => versionOf(v) === selected)

  const onRestore = async (version: number) => {
    try {
      const stub = await restore.mutateAsync({ id, version })
      toast.success(t('history.restored', { version }))
      setSelected(null)
      onRestored(stub)
    } catch (error) {
      toast.error(t('history.restoreFailed'), { description: error instanceof Error ? error.message : undefined })
    }
  }

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button variant="outline" size="sm">
          <HistoryIcon data-icon="inline-start" />
          {t('history.open')}
        </Button>
      </SheetTrigger>
      <SheetContent className="glass-panel flex w-full flex-col gap-0 sm:max-w-xl">
        <SheetHeader>
          <SheetTitle>{t('history.title')}</SheetTitle>
          <SheetDescription className="text-xs">{t('history.caption')}</SheetDescription>
        </SheetHeader>
        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-auto px-4 pb-4">
          {history.isError ? (
            <Alert variant="destructive">
              <AlertCircleIcon />
              <AlertTitle>{t('history.loadFailed')}</AlertTitle>
              <AlertDescription>{history.error.message}</AlertDescription>
            </Alert>
          ) : history.isPending ? (
            <div className="flex flex-col gap-2">
              {Array.from({ length: 3 }, (_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : history.data.length === 0 ? (
            <p className="py-6 text-center text-xs text-muted-foreground">{t('history.empty')}</p>
          ) : (
            <>
              <ul aria-label={t('history.versions')} className="flex flex-col gap-1">
                {history.data.map((stub) => {
                  const meta = stub.metadata?.wiremockUi
                  const version = versionOf(stub)
                  const active = version === selected
                  return (
                    <li key={version}>
                      <button
                        type="button"
                        aria-pressed={active}
                        onClick={() => setSelected(version)}
                        className={cn(
                          'flex w-full items-center justify-between gap-3 rounded-md border border-line bg-surface-2/40 px-3 py-2 text-start text-xs transition-colors hover:border-signal/40 focus-visible:ring-3 focus-visible:ring-ring/40 focus-visible:outline-none',
                          active && 'border-signal/60 bg-signal/10 text-signal-fg',
                        )}
                      >
                        <span className="font-medium">{t('history.version', { version })}</span>
                        <span className="flex min-w-0 items-center gap-2 text-muted-foreground">
                          <span className="truncate">{t('history.by', { user: meta?.updatedBy || '—' })}</span>
                          <span aria-hidden>·</span>
                          <span className="shrink-0">{isValidDate(meta?.updatedAt) ? relativeTime(meta.updatedAt) : '—'}</span>
                        </span>
                      </button>
                    </li>
                  )
                })}
              </ul>
              {chosen ? (
                <section className="flex flex-col gap-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <Eyebrow>{t('history.version', { version: versionOf(chosen) })}</Eyebrow>
                    <Button size="sm" disabled={restore.isPending} onClick={() => void onRestore(versionOf(chosen))}>
                      {restore.isPending ? <Spinner data-icon="inline-start" /> : <RotateCcwIcon data-icon="inline-start" />}
                      {restore.isPending ? t('history.restoring') : t('history.restore')}
                    </Button>
                  </div>
                  <CodeEditor
                    value={JSON.stringify(chosen, null, 2)}
                    language="json"
                    label={t('history.versionJson', { version: versionOf(chosen) })}
                    readOnly
                  />
                </section>
              ) : (
                <p className="text-xs text-muted-foreground">{t('history.pick')}</p>
              )}
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}
