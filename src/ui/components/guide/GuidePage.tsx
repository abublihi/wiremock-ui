import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { Link, useNavigate, useRouterState } from '@tanstack/react-router'
import { ListChecksIcon, SearchIcon, XIcon } from 'lucide-react'
import { Button } from '@/ui/components/ui/button'
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from '@/ui/components/ui/input-group'
import { useT } from '@/ui/i18n'
import { GUIDE_SECTIONS, filterMenu, type GuideSection } from '@/ui/lib/guide'
import { cn } from '@/ui/lib/utils'
import { reopenChecklist, useChecklistUser } from './GettingStarted'
import { GuideMarkdown } from './GuideMarkdown'

/**
 * The guide: every feature, the same shape each time (what it is, what it does in WireMock, how to, tips), from
 * docs/guide/*.md. The side menu lists the sections; its "Find a section" box narrows the menu (section titles and
 * their sub-headings, never the article text). `/guide#scenarios` or `/guide#recording--nothing-was-recorded` opens
 * on that place.
 */
export function GuidePage({ sections = GUIDE_SECTIONS }: { sections?: GuideSection[] }) {
  const t = useT()
  const hash = useRouterState({ select: (s) => s.location.hash })

  // A deep link (or a menu pick) scrolls its section or sub-heading into view and moves focus there.
  useEffect(() => {
    if (!hash) return
    // A topic that is not a sub-heading here (a GitHub-style anchor) falls back to its section.
    const target = document.getElementById(hash) ?? document.getElementById(hash.split('--')[0])
    if (!target) return
    target.scrollIntoView({ block: 'start' })
    const focusable = document.getElementById(`${hash}-title`) ?? target
    focusable.focus({ preventScroll: true })
  }, [hash])

  return (
    <div className="fade-up flex flex-col gap-5">
      <header>
        <h1 className="glow-text font-display text-4xl font-bold tracking-tight uppercase">{t('guide.title')}</h1>
        <p className="text-xs text-muted-foreground">{t('guide.caption')}</p>
        <p className="mt-1 text-xs text-muted-foreground">{t('guide.shortcut')}</p>
      </header>

      <div className="grid gap-6 lg:grid-cols-[240px_minmax(0,1fr)]">
        {/* Narrow screens: the menu folds away above the sections; it works the same inside. */}
        <details className="group rounded-md border border-line bg-surface/70 px-3 py-2 lg:hidden">
          <summary className="cursor-pointer text-xs font-medium">{t('guide.contents')}</summary>
          <div className="mt-2">
            <GuideMenu sections={sections} current={hash} />
          </div>
        </details>
        <aside className="sticky top-16 hidden max-h-[calc(100svh-6rem)] self-start overflow-y-auto lg:block">
          <GuideMenu sections={sections} current={hash} />
        </aside>
        <div className="flex min-w-0 flex-col gap-6">
          {sections.map((s) => (
            <GuideSectionView key={s.slug} section={s} />
          ))}
        </div>
      </div>
    </div>
  )
}

/** `text` with every case-insensitive occurrence of `query` marked. */
function Highlight({ text, query }: { text: string; query: string }): ReactNode {
  const q = query.trim()
  if (!q) return text
  const parts: ReactNode[] = []
  const lower = text.toLowerCase()
  const needle = q.toLowerCase()
  let from = 0
  for (let at = lower.indexOf(needle); at !== -1; at = lower.indexOf(needle, from)) {
    parts.push(text.slice(from, at), <mark key={at} className="rounded-xs bg-signal/25 px-0.5 text-foreground">{text.slice(at, at + q.length)}</mark>)
    from = at + q.length
  }
  parts.push(text.slice(from))
  return parts
}

/**
 * The side menu: "Find a section" on top, then the sections (and, while searching, their matching sub-headings).
 * Arrow keys move through the links, Enter in the box opens the first one.
 */
function GuideMenu({ sections, current }: { sections: GuideSection[]; current: string }) {
  const t = useT()
  const navigate = useNavigate()
  const id = useId()
  const [query, setQuery] = useState('')
  const entries = useMemo(() => filterMenu(query, sections), [query, sections])
  const list = useRef<HTMLOListElement>(null)
  const links = () => [...(list.current?.querySelectorAll<HTMLAnchorElement>('a[data-menu-link]') ?? [])]

  const onBoxKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      links()[0]?.focus()
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const first = entries[0]
      if (first) void navigate({ to: '/guide', hash: first.topics[0] && !first.titleMatch ? first.topics[0].id : first.section.slug })
    } else if (e.key === 'Escape' && query) {
      e.preventDefault()
      setQuery('')
    }
  }
  const onListKey = (e: KeyboardEvent<HTMLOListElement>) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp' && e.key !== 'Home' && e.key !== 'End') return
    const all = links()
    const at = all.indexOf(document.activeElement as HTMLAnchorElement)
    if (at === -1) return
    e.preventDefault()
    const next = e.key === 'Home' ? 0 : e.key === 'End' ? all.length - 1 : at + (e.key === 'ArrowDown' ? 1 : -1)
    if (next < 0) document.getElementById(`${id}-find`)?.focus()
    else all[Math.min(next, all.length - 1)]?.focus()
  }

  const linkClass =
    'block rounded-sm px-2 py-1.5 text-muted-foreground transition-colors outline-none hover:bg-surface-2 hover:text-foreground focus-visible:bg-surface-2 focus-visible:text-foreground focus-visible:ring-2 focus-visible:ring-ring aria-[current=true]:bg-signal/8 aria-[current=true]:text-signal-fg'

  return (
    <nav aria-label={t('guide.contents')} className="flex flex-col gap-2">
      <div>
        <label htmlFor={`${id}-find`} className="mb-1 block px-1 text-[11px] font-medium tracking-[0.18em] text-muted-foreground uppercase">
          <span aria-hidden>// </span>
          {t('guide.find')}
        </label>
        <InputGroup>
          <InputGroupAddon>
            <SearchIcon aria-hidden />
          </InputGroupAddon>
          <InputGroupInput
            id={`${id}-find`}
            type="search"
            autoComplete="off"
            className="[&::-webkit-search-cancel-button]:appearance-none"
            placeholder={t('guide.findPlaceholder')}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onBoxKey}
            aria-controls={`${id}-list`}
            aria-describedby={`${id}-count`}
          />
          {query && (
            <InputGroupAddon align="inline-end">
              <InputGroupButton size="icon-xs" aria-label={t('guide.clearSearch')} onClick={() => setQuery('')}>
                <XIcon />
              </InputGroupButton>
            </InputGroupAddon>
          )}
        </InputGroup>
        <p id={`${id}-count`} aria-live="polite" className={cn('mt-1 px-1 text-xs text-muted-foreground', !query && 'sr-only')}>
          {query
            ? entries.length === 0
              ? t('guide.noSection', { query: query.trim() })
              : t(entries.length === 1 ? 'guide.matchesOne' : 'guide.matches', { count: entries.length })
            : t('guide.findHint')}
        </p>
      </div>
      <ol ref={list} id={`${id}-list`} onKeyDown={onListKey} className="flex flex-col gap-0.5 text-xs">
        {entries.map(({ section, topics }) => (
          <li key={section.slug}>
            <Link to="/guide" hash={section.slug} data-menu-link="" className={linkClass} aria-current={current === section.slug ? 'true' : undefined}>
              <span aria-hidden className="me-2 font-mono text-[11px] text-signal-fg/70">
                {String(section.order).padStart(2, '0')}
              </span>
              <Highlight text={section.title} query={query} />
            </Link>
            {topics.length > 0 && (
              <ol className="ms-6 flex flex-col gap-0.5 border-s border-line/70 ps-1">
                {topics.map((topic) => (
                  <li key={topic.id}>
                    <Link to="/guide" hash={topic.id} data-menu-link="" className={cn(linkClass, 'py-1')} aria-current={current === topic.id ? 'true' : undefined}>
                      <Highlight text={topic.text} query={query} />
                    </Link>
                  </li>
                ))}
              </ol>
            )}
          </li>
        ))}
      </ol>
    </nav>
  )
}

function GuideSectionView({ section }: { section: GuideSection }) {
  const t = useT()
  const navigate = useNavigate()
  const checklistUser = useChecklistUser()
  return (
    <section
      id={section.slug}
      aria-labelledby={`${section.slug}-title`}
      className="scroll-mt-16 rounded-md border border-line bg-surface/70 p-4 backdrop-blur-sm sm:p-6"
    >
      <p aria-hidden className="font-mono text-[11px] tracking-[0.18em] text-signal-fg uppercase">
        // {String(section.order).padStart(2, '0')} · {section.slug}
      </p>
      <h2 id={`${section.slug}-title`} tabIndex={-1} className="font-display text-2xl font-bold tracking-wide uppercase outline-none">
        {section.title}
      </h2>
      {section.summary && <p className="mt-1 text-xs text-muted-foreground">{section.summary}</p>}
      <GuideMarkdown markdown={section.body} slug={section.slug} />
      {section.slug === 'getting-started' && (
        <Button
          variant="outline"
          size="sm"
          className="mt-3"
          onClick={() => {
            reopenChecklist(checklistUser)
            void navigate({ to: '/mocks' })
          }}
        >
          <ListChecksIcon data-icon="inline-start" />
          {t('guide.reopenChecklist')}
        </Button>
      )}
    </section>
  )
}
