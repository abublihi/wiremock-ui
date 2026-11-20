import { trimTrailingSlashes } from '@/server/url'
import { isValidElement, type ReactElement, type ReactNode } from 'react'
import Markdown, { defaultUrlTransform, type Components } from 'react-markdown'
import { useConfiguredPublicUrl } from '@/ui/config'
import remarkGfm from 'remark-gfm'
import { Link } from '@tanstack/react-router'
import { ExternalLinkIcon } from 'lucide-react'
import { useT } from '@/ui/i18n'
import { guideHref, topicId } from '@/ui/lib/guide'
import { cn } from '@/ui/lib/utils'

/** Elements the guide never renders, whatever the Markdown says (raw HTML is skipped as well). */
const DISALLOWED = ['script', 'iframe', 'object', 'embed', 'style', 'form', 'input', 'img']

/**
 * Only http(s), mailto and relative links survive; react-markdown's own check already drops `javascript:`, `data:`
 * and other schemes, this keeps it that way if its default ever changes.
 */
export function safeGuideUrl(url: string): string {
  const safe = defaultUrlTransform(url)
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(safe)?.[1]?.toLowerCase()
  return scheme && !['http', 'https', 'mailto'].includes(scheme) ? '' : safe
}

/**
 * Renders one guide section's Markdown. Links to other guide files (`scenarios.md`) and app pages (`/integrations`)
 * become router links; a fenced block marked `stub` folds into "The stub JSON this produces". `onNavigate` runs
 * after an internal link is followed (the help panel closes itself).
 */
export function GuideMarkdown({
  markdown,
  slug,
  onNavigate,
  className,
}: {
  markdown: string
  /** The section the Markdown is: its sub-headings get anchors the side menu jumps to (`slug--heading`). */
  slug?: string
  onNavigate?: () => void
  className?: string
}) {
  const t = useT()
  // The guide's examples use WireMock's default address; in the app they show this install's (WIREMOCK_PUBLIC_URL).
  const configured = useConfiguredPublicUrl()
  const publicUrl = configured === undefined ? undefined : trimTrailingSlashes(configured)
  const text = publicUrl ? markdown.split('http://localhost:8080').join(publicUrl) : markdown
  // The section title is the page's h2, so the file's ## and ### sit one level below it.
  const components: Components = {
    h1: ({ children }) => <h3>{children}</h3>,
    h2: ({ children }) => <h3>{children}</h3>,
    h3: ({ children }) => (
      <h4 id={slug ? topicId(slug, textOf(children)) : undefined} tabIndex={slug ? -1 : undefined} className="scroll-mt-16 outline-none">
        {children}
      </h4>
    ),
    // A paragraph that starts with a bold task name ("**Build a scenario.**") is a sub-heading the menu can jump to.
    p: ({ children }) => {
      const lead = firstElement(children)
      const text = lead && lead.type === 'strong' ? textOf((lead.props as { children?: ReactNode }).children) : ''
      const anchor = slug && /[.?]$/.test(text) && firstElement(children) === (Array.isArray(children) ? children[0] : children)
      return (
        <p id={anchor ? topicId(slug, text.replace(/[.]$/, '')) : undefined} tabIndex={anchor ? -1 : undefined} className={anchor ? 'scroll-mt-16 outline-none' : undefined}>
          {children}
        </p>
      )
    },
    h4: ({ children }) => <h5 className="font-semibold">{children}</h5>,
    a: ({ href, children }) => {
      if (!href) return <span>{children}</span>
      const target = guideHref(href)
      if (target.kind === 'guide') {
        return (
          <Link to="/guide" hash={target.hash} onClick={onNavigate}>
            {children}
          </Link>
        )
      }
      if (target.kind === 'app') {
        return (
          <Link to={target.to as '/'} hash={target.hash} onClick={onNavigate}>
            {children}
          </Link>
        )
      }
      return (
        <a href={target.href} target="_blank" rel="noreferrer noopener">
          {children}
          <ExternalLinkIcon aria-hidden className="ms-0.5 inline size-3 align-baseline" />
          <span className="sr-only"> {t('guide.opensNewTab')}</span>
        </a>
      )
    },
    pre: ({ children }) => {
      const code = firstElement(children)
      const className = (code?.props as { className?: string } | undefined)?.className ?? ''
      if (className.includes('language-stub')) {
        return (
          <details className="rounded-md border border-line bg-surface/60 px-3 py-2">
            <summary className="cursor-pointer text-xs font-medium text-signal-fg">{t('guide.stubJson')}</summary>
            <pre dir="ltr">{children}</pre>
          </details>
        )
      }
      return <pre dir="ltr">{children}</pre>
    },
    table: ({ children }) => (
      <div className="overflow-x-auto">
        <table>{children}</table>
      </div>
    ),
  }
  return (
    <div className={cn('guide-prose', className)}>
      <Markdown
        remarkPlugins={[remarkGfm]}
        skipHtml
        disallowedElements={DISALLOWED}
        unwrapDisallowed={false}
        urlTransform={safeGuideUrl}
        components={components}
      >
        {text}
      </Markdown>
    </div>
  )
}

function firstElement(children: ReactNode): ReactElement | undefined {
  const list = Array.isArray(children) ? children : [children]
  return list.find((c): c is ReactElement => isValidElement(c))
}

/** The plain text of rendered children (for anchors). */
function textOf(children: ReactNode): string {
  if (typeof children === 'string' || typeof children === 'number') return String(children)
  if (Array.isArray(children)) return children.map(textOf).join('')
  if (isValidElement(children)) return textOf((children.props as { children?: ReactNode }).children)
  return ''
}
