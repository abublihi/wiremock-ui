import type { ReactNode } from 'react'
import { Link } from '@tanstack/react-router'
import { ArrowLeftIcon } from 'lucide-react'
import { useT } from '@/ui/i18n'

/** The editor page frame: back link, title with a `//` caption, actions, and the form beside an aside. */
export function EditorShell({
  title,
  caption,
  actions,
  aside,
  back,
  notice,
  children,
}: {
  title: string
  caption: string
  actions?: ReactNode
  aside?: ReactNode
  /** The back link (defaults to the mock list); style it with `backLinkClass`. */
  back?: ReactNode
  /** A banner between the header and the form (e.g. "Adding a step to scenario …"). */
  notice?: ReactNode
  children: ReactNode
}) {
  const t = useT()
  return (
    <div className="fade-up flex flex-col gap-5">
      <header className="flex flex-col gap-3">
        {back ?? (
          <Link to="/mocks" className={backLinkClass}>
            <ArrowLeftIcon aria-hidden className="size-3.5" />
            {t('editor.back')}
          </Link>
        )}
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="min-w-0">
            <h1 className="glow-text font-display text-4xl font-bold tracking-tight break-words uppercase">{title}</h1>
            <p className="truncate text-xs text-muted-foreground">{caption}</p>
          </div>
          {actions && <div className="flex items-center gap-2">{actions}</div>}
        </div>
      </header>
      {notice}
      {aside ? (
        <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_18rem]">
          <div className="min-w-0">{children}</div>
          <aside className="flex min-w-0 flex-col gap-4 lg:sticky lg:top-4">{aside}</aside>
        </div>
      ) : (
        children
      )}
    </div>
  )
}

export const backLinkClass = 'inline-flex w-fit items-center gap-1.5 text-xs text-muted-foreground hover:text-signal-fg'

/** A small uppercase section eyebrow (`— Match`). */
export function Eyebrow({ children, id }: { children: ReactNode; id?: string }) {
  return (
    <h2 id={id} className="text-[10px] font-medium tracking-[0.18em] text-muted-foreground uppercase">
      <span aria-hidden="true">— </span>
      {children}
    </h2>
  )
}
