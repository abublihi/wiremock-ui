import { Link } from '@tanstack/react-router'
import { SquareIcon } from 'lucide-react'
import { useRecordingState } from '@/ui/api/queries'
import { useStopAndReview } from '@/ui/components/recording/RecordForms'
import { Button } from '@/ui/components/ui/button'
import { useRecordingAllowed } from '@/ui/config'
import { useT } from '@/ui/i18n'

/**
 * App-wide while WireMock records (spec A12): a pulsing hazard band naming the target, with Stop. Stopping opens
 * the review list it produced. Renders nothing (and polls nothing) when recording is not allowed.
 */
export function RecordingBanner() {
  const allowed = useRecordingAllowed()
  const state = useRecordingState({ enabled: allowed })
  if (!allowed || state.data?.status !== 'recording') return null
  return <Banner target={state.data.target} />
}

function Banner({ target }: { target: string | null }) {
  const t = useT()
  const stop = useStopAndReview()
  return (
    <div
      role="status"
      className="relative z-30 flex shrink-0 flex-wrap items-center justify-center gap-x-3 gap-y-1 border-b border-hazard/50 bg-hazard/12 px-4 py-1.5 text-xs text-foreground md:pt-6"
    >
      <span aria-hidden className="recording-pulse size-2 shrink-0 rounded-full bg-mismatch" />
      <span className="min-w-0 font-medium break-all">{target ? t('recording.banner', { url: target }) : t('recording.bannerUnknown')}</span>
      <Link to="/recording" className="underline underline-offset-2 hover:text-signal-fg">
        {t('recording.bannerOpen')}
      </Link>
      <Button variant="outline" size="xs" disabled={stop.pending} onClick={() => void stop.run()}>
        <SquareIcon data-icon="inline-start" />
        {t('recording.stop')}
      </Button>
    </div>
  )
}
