import { Fragment, useEffect, useId, useState } from 'react'
import { ArrowDownIcon, ArrowRightIcon, HelpCircleIcon, XIcon } from 'lucide-react'
import { Button } from '@/ui/components/ui/button'
import { useT } from '@/ui/i18n'

const DISMISSED = 'wmui.catalogExplainer.dismissed'

/**
 * Whether this browser still shows the "How it fits together" strip. Null until mounted:
 * the server render cannot see this browser's storage, and storage may be unavailable.
 */
export function useExplainer() {
  const [shown, setShown] = useState<boolean | null>(null)
  useEffect(() => {
    let dismissed = false
    try {
      dismissed = localStorage.getItem(DISMISSED) === '1'
    } catch {}
    setShown(!dismissed)
  }, [])
  const remember = (next: boolean) => {
    setShown(next)
    try {
      if (next) localStorage.removeItem(DISMISSED)
      else localStorage.setItem(DISMISSED, '1')
    } catch {}
  }
  return { shown, show: () => remember(true), hide: () => remember(false) }
}

/** The header button that brings the strip back once it was hidden. */
export function ShowExplainerButton({ onClick }: { onClick: () => void }) {
  const t = useT()
  return (
    <Button variant="ghost" size="sm" onClick={onClick}>
      <HelpCircleIcon data-icon="inline-start" />
      {t('catalog.explainer.show')}
    </Button>
  )
}

/** Integration → Endpoint → Mock in one glance, with the Blog API example. */
export function HowItFits({ onHide }: { onHide: () => void }) {
  const t = useT()
  const titleId = useId()
  const steps = [
    { n: '01', title: t('catalog.explainer.integration'), body: t('catalog.explainer.integrationBody'), example: ['Blog API · /blog'] },
    {
      n: '02',
      title: t('catalog.explainer.endpoint'),
      body: t('catalog.explainer.endpointBody'),
      example: ['GET /blog/posts/{id}', t('catalog.explainer.endpointKey')],
    },
    { n: '03', title: t('catalog.explainer.mock'), body: t('catalog.explainer.mockBody'), example: [t('catalog.explainer.mockExample')] },
  ]
  return (
    <section aria-labelledby={titleId} className="glass-panel fade-up relative flex flex-col gap-4 rounded-md border border-line p-4 sm:p-5">
      <div className="flex items-start justify-between gap-3">
        <h2 id={titleId} className="text-[11px] font-medium tracking-[0.18em] text-muted-foreground uppercase">
          <span aria-hidden="true">— </span>
          {t('catalog.explainer.title')}
        </h2>
        <Button variant="ghost" size="icon-sm" className="-me-1.5 -mt-1.5" aria-label={t('catalog.explainer.hide')} onClick={onHide}>
          <XIcon />
        </Button>
      </div>
      <ol className="grid items-stretch gap-2 md:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)_auto_minmax(0,1fr)]">
        {steps.map((step, i) => (
          <Fragment key={step.n}>
            {i > 0 && (
              <li aria-hidden="true" className="flex items-center justify-center text-signal-fg/70">
                <ArrowRightIcon className="hidden size-4 md:block rtl:rotate-180" />
                <ArrowDownIcon className="size-4 md:hidden" />
              </li>
            )}
            <li className="flex flex-col gap-2 rounded-md border border-line bg-surface p-3">
              <div className="flex items-baseline gap-2">
                <span className="font-mono text-[11px] text-signal-fg">{step.n}</span>
                <h3 className="font-display text-lg leading-none font-semibold tracking-wide uppercase">{step.title}</h3>
              </div>
              <p className="text-xs leading-relaxed text-muted-foreground">{step.body}</p>
              <div className="mt-auto flex flex-col gap-0.5 rounded-sm border border-line/70 bg-surface-2 px-2 py-1.5">
                {step.example.map((line) => (
                  <code key={line} dir="ltr" className="font-mono text-xs break-all">
                    {line}
                  </code>
                ))}
              </div>
            </li>
          </Fragment>
        ))}
      </ol>
      <p className="text-xs text-muted-foreground">{t('catalog.explainer.footer')}</p>
    </section>
  )
}
