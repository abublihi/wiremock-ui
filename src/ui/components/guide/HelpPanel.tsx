import { useEffect, useState } from 'react'
import { Link, useNavigate, useRouterState } from '@tanstack/react-router'
import { BookOpenIcon, CircleHelpIcon } from 'lucide-react'
import { Button } from '@/ui/components/ui/button'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from '@/ui/components/ui/sheet'
import { useT } from '@/ui/i18n'
import { sectionForPath } from '@/ui/lib/guide'
import { GuideMarkdown } from './GuideMarkdown'

/**
 * The page header's "How this works" (?) button: a side panel with the guide section for the page you are on, and a
 * link to the whole guide. Not shown on the guide itself, nor on a page no section covers.
 */
export function HelpPanel() {
  const t = useT()
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const section = sectionForPath(pathname)
  const [open, setOpen] = useState(false)
  // A link inside the panel navigates: close it so the new page is in view.
  useEffect(() => setOpen(false), [pathname])
  if (!section || pathname === '/guide') return null
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button variant="ghost" size="sm" className="text-muted-foreground" aria-label={t('help.button')}
          title={t('help.buttonLabel', { title: section.title })}>
          <CircleHelpIcon data-icon="inline-start" />
          <span className="hidden sm:inline">{t('help.button')}</span>
        </Button>
      </SheetTrigger>
      <SheetContent side="end" className="w-[92vw] gap-0 p-0 data-[side=end]:sm:max-w-xl">
        <SheetHeader className="border-b border-line/60 px-5 pt-5 pb-4">
          <p aria-hidden className="font-mono text-[11px] tracking-[0.18em] text-signal-fg uppercase">
            // {t('help.eyebrow')}
          </p>
          <SheetTitle className="font-display text-2xl font-bold tracking-wide uppercase">{section.title}</SheetTitle>
          <SheetDescription className="text-xs">{section.summary}</SheetDescription>
        </SheetHeader>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          <GuideMarkdown markdown={section.body} onNavigate={() => setOpen(false)} />
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-line/60 px-5 py-3">
          <Button asChild variant="outline" size="sm">
            <Link to="/guide" hash={section.slug} onClick={() => setOpen(false)}>
              <BookOpenIcon data-icon="inline-start" />
              {t('help.openGuide')}
            </Link>
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  )
}

/** True when a key press is typing into something (an input, a text area, an editor), not a shortcut. */
function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  return target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName) || target.closest('[role="textbox"], .cm-editor') !== null
}

/** `?` anywhere (outside a text field) opens the guide. */
export function useGuideShortcut() {
  const navigate = useNavigate()
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== '?' || e.ctrlKey || e.metaKey || e.altKey || e.defaultPrevented || isTyping(e.target)) return
      e.preventDefault()
      void navigate({ to: '/guide' })
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [navigate])
}
