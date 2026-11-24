import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import userEvent from '@testing-library/user-event'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { Outlet, RouterProvider, createMemoryHistory, createRootRoute, createRoute, createRouter } from '@tanstack/react-router'
import { TooltipProvider } from '@/ui/components/ui/tooltip'
import { PrefsProvider } from '@/ui/i18n'
import { http, HttpResponse } from 'msw'
import { setupServer } from 'msw/node'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { GettingStartedChecklist, markRequestLogSeen, reopenChecklist } from '@/ui/components/guide/GettingStarted'
import { GuideMarkdown } from '@/ui/components/guide/GuideMarkdown'
import { GuidePage } from '@/ui/components/guide/GuidePage'
import { HelpPanel, useGuideShortcut } from '@/ui/components/guide/HelpPanel'
import { Term } from '@/ui/components/guide/Term'
import {
  checklistKey,
  GLOSSARY,
  GUIDE_SECTIONS,
  guideHref,
  parseGuideFile,
  sectionsFrom,
  filterMenu,
  topicsOf,
  sectionForPath,
} from '@/ui/lib/guide'
import { renderApp } from './helpers'

// The test session signs in as user u1.
const CHECKLIST_DISMISSED_KEY = 'wmui.checklist.u1.dismissed'
const CHECKLIST_DONE_KEY = 'wmui.checklist.u1.done'
const REQUEST_SENT_KEY = 'wmui.checklist.u1.requestSent'

const GUIDE_DIR = join(process.cwd(), 'docs/guide')
const files = readdirSync(GUIDE_DIR).filter((f) => f.endsWith('.md'))

const server = setupServer()
beforeAll(() => server.listen({ onUnhandledFrame: 'error' }))
afterEach(() => server.resetHandlers())
afterAll(() => server.close())
beforeEach(() => window.localStorage.clear())

const BASE = 'http://localhost:3000'

describe('guide content (docs/guide/*.md)', () => {
  it('refuses to build an empty guide (docs/guide missing from the build context)', () => {
    expect(() => sectionsFrom({})).toThrow(/docs\/guide/)
  })

  it('has every section the brief asks for, in order, each read from its own file', () => {
    expect(GUIDE_SECTIONS.map((s) => s.slug)).toEqual([
      'getting-started',
      'concepts',
      'mocks',
      'tags',
      'testing',
      'request-log',
      'scenarios',
      'proxy',
      'webhooks',
      'recording',
      'import-export',
      'users-audit',
      'storage',
      'sync',
      'api',
      'troubleshooting',
      'glossary',
    ])
    expect(GUIDE_SECTIONS).toHaveLength(files.length)
  })

  it('gives every section the same shape: what it is, what it does in WireMock, how to, tips and limits', () => {
    for (const s of GUIDE_SECTIONS) {
      const headings = [...s.body.matchAll(/^## (.+)$/gm)].map((m) => m[1])
      expect(headings, s.slug).toEqual(['What it is', 'What it does in WireMock', 'How to', 'Tips and limits'])
      expect(s.summary, s.slug).not.toBe('')
      expect(s.body.startsWith('# '), s.slug).toBe(false) // the file's own title becomes the section heading
    }
  })

  it('uses the Blog and Orders examples, never the old NIC / citizen ones', () => {
    for (const f of files) {
      const text = readFileSync(join(GUIDE_DIR, f), 'utf8')
      expect(text, f).not.toMatch(/\bNIC\b|citizen|idNo|1012345678|loan/i)
    }
    expect(GUIDE_SECTIONS.some((s) => s.body.includes('Blog API'))).toBe(true)
    expect(GUIDE_SECTIONS.some((s) => s.body.includes('/orders/'))).toBe(true)
  })

  it('links only to guide files that exist and to app pages', () => {
    const slugs = new Set(GUIDE_SECTIONS.map((s) => s.slug))
    for (const s of GUIDE_SECTIONS) {
      for (const [, href] of s.body.matchAll(/\]\(([^)]+)\)/g)) {
        const target = guideHref(href)
        if (target.kind === 'guide') expect(slugs.has(target.hash.split('--')[0]), `${s.slug} → ${href}`).toBe(true)
        else if (target.kind === 'app') expect(target.to, `${s.slug} → ${href}`).toMatch(/^\/(mocks|mocks\/new|requests|scenarios|recording|import|users|audit)$/)
        else expect(href, `${s.slug} → ${href}`).toMatch(/^https:\/\//)
      }
    }
  })

  it('parses front-matter and refuses a file without it', () => {
    const s = parseGuideFile('x', '---\ntitle: X\norder: 3\nroutes: /a, /b\nsummary: Hi\n---\n# X\n\nBody')
    expect(s).toEqual({ slug: 'x', title: 'X', order: 3, routes: ['/a', '/b'], summary: 'Hi', body: 'Body' })
    expect(() => parseGuideFile('y', 'no front matter')).toThrow(/missing front-matter/)
  })

  it('reads the glossary table for the tooltips', () => {
    expect(GLOSSARY.get('near miss')).toMatch(/almost matched/)
    expect(GLOSSARY.get('mapping')).toBe(GLOSSARY.get('stub'))
    expect(GLOSSARY.get('baseline')).toMatch(/owned by nobody/)
  })
})

describe('search and links', () => {
  it('lists each section\'s sub-headings: ### headings and bold task lead-ins, with anchors', () => {
    const recording = topicsOf(GUIDE_SECTIONS.find((s) => s.slug === 'recording')!)
    expect(recording).toContainEqual({ id: 'recording--nothing-was-recorded', text: 'Nothing was recorded?' })
    const log = topicsOf(GUIDE_SECTIONS.find((s) => s.slug === 'request-log')!)
    expect(log.map((t) => t.text)).toContain("Why didn't my mock match?")
    // The four shared headings are not menu entries.
    expect(GUIDE_SECTIONS.flatMap(topicsOf).map((t) => t.text)).not.toContain('How to')
  })

  it('the menu filter looks at section titles and sub-headings only, never the body text', () => {
    expect(filterMenu('')).toHaveLength(GUIDE_SECTIONS.length)
    const scen = filterMenu('SCENARIO')
    expect(scen.map((e) => e.section.slug)).toEqual(expect.arrayContaining(['scenarios']))
    expect(scen.find((e) => e.section.slug === 'scenarios')?.titleMatch).toBe(true)
    const recorded = filterMenu('nothing was recorded')
    expect(recorded.map((e) => [e.section.slug, e.titleMatch, e.topics.map((t) => t.text)])).toEqual([['recording', false, ['Nothing was recorded?']]])
    // "pending" is in the scenarios text, but in no title or heading.
    expect(filterMenu('pending')).toEqual([])
  })

  it('maps links: guide files to /guide#section, app paths to the router, everything else outside', () => {
    expect(guideHref('scenarios.md')).toEqual({ kind: 'guide', hash: 'scenarios' })
    expect(guideHref('./sync.md#marker')).toEqual({ kind: 'guide', hash: 'sync--marker' })
    expect(guideHref('/scenarios')).toEqual({ kind: 'app', to: '/scenarios' })
    expect(guideHref('//evil.example/x')).toEqual({ kind: 'external', href: '//evil.example/x' })
    expect(guideHref('https://wiremock.org')).toEqual({ kind: 'external', href: 'https://wiremock.org' })
  })

  it.each([
    ['/mocks', 'mocks'],
    ['/mocks/new', 'mocks'],
    ['/mocks/abc-123', 'mocks'],
    ['/requests', 'request-log'],
    ['/scenarios/new', 'scenarios'],
    ['/scenarios/order-status/edit', 'scenarios'],
    ['/recording', 'recording'],
    ['/import', 'import-export'],
    ['/users', 'users-audit'],
    ['/audit', 'users-audit'],
  ])('the help panel on %s shows the %s section', (path, slug) => {
    expect(sectionForPath(path)?.slug).toBe(slug)
  })
})

describe('Markdown rendering', () => {
  it('is sanitized: no raw HTML, no script or iframe, no javascript: or data: links, no images', async () => {
    const markdown = [
      '<script>window.hacked = true</script>',
      '<iframe src="https://evil.example"></iframe>',
      '<img src=x onerror="window.hacked = true">',
      '[click](javascript:alert(1)) [data](data:text/html,hi) [vb](vbscript:x)',
      '![logo](https://evil.example/x.png)',
      'Plain **text** stays.',
    ].join('\n\n')
    await renderApp(<GuideMarkdown markdown={markdown} />)
    await screen.findByText(/stays/)
    const container = document.body
    expect(container.querySelector('script, iframe, img, object, embed')).toBeNull()
    for (const a of container.querySelectorAll('a')) expect(a.getAttribute('href') ?? '').not.toMatch(/^(javascript|data|vbscript):/i)
    expect((window as unknown as { hacked?: boolean }).hacked).toBeUndefined()
  })

  it('turns guide and app links into router links, and folds stub JSON', async () => {
    await renderApp(<GuideMarkdown markdown={'See [Scenarios](scenarios.md) or [Open the request log →](/requests).\n\n```stub\n{"request":{}}\n```'} />)
    expect(screen.getByRole('link', { name: 'Scenarios' }).getAttribute('href')).toBe('/guide#scenarios')
    expect(screen.getByRole('link', { name: 'Open the request log →' }).getAttribute('href')).toBe('/requests')
    const summary = screen.getByText('The stub JSON this produces')
    expect(summary.tagName).toBe('SUMMARY')
    expect(summary.closest('details')?.querySelector('pre')?.textContent).toContain('"request"')
  })
})

describe('Guide page', () => {
  it('renders every section with a heading and a table of contents', async () => {
    await renderApp(<GuidePage />)
    for (const s of GUIDE_SECTIONS) expect(screen.getByRole('heading', { level: 2, name: s.title })).toBeTruthy()
    const toc = screen.getAllByRole('navigation', { name: 'Contents' })[0]
    expect(within(toc).getAllByRole('link')).toHaveLength(GUIDE_SECTIONS.length)
    expect(within(toc).getByRole('link', { name: /Scenarios and the builder/ }).getAttribute('href')).toBe('/guide#scenarios')
  })

  it('"Find a section" narrows only the menu, highlights the match, and keeps the article whole', async () => {
    await renderApp(<GuidePage />)
    const ue = userEvent.setup()
    const menu = screen.getAllByRole('navigation', { name: 'Contents' }).at(-1)!
    const box = within(menu).getByRole('searchbox', { name: 'Find a section' })
    await ue.type(box, 'near miss')
    expect(within(menu).getAllByRole('link').map((a) => a.textContent)).toEqual(['06Request log and near misses'])
    expect(within(menu).getByText('near miss', { selector: 'mark' })).toBeTruthy()
    expect(within(menu).getByText('1 section matches')).toBeTruthy()
    // The article is not filtered.
    expect(screen.getAllByRole('heading', { level: 2 })).toHaveLength(GUIDE_SECTIONS.length)

    await ue.clear(box)
    await ue.type(box, 'zzz-nothing')
    expect(within(menu).getByText('No section matches “zzz-nothing”')).toBeTruthy()
    expect(within(menu).queryAllByRole('link')).toHaveLength(0)
    expect(screen.getAllByRole('heading', { level: 2 })).toHaveLength(GUIDE_SECTIONS.length)
  })

  it('arrow keys move through the filtered menu; Enter jumps to the first match', async () => {
    const { router } = await renderApp(<GuidePage />)
    const ue = userEvent.setup()
    const menu = screen.getAllByRole('navigation', { name: 'Contents' }).at(-1)!
    const box = within(menu).getByRole('searchbox', { name: 'Find a section' })
    await ue.type(box, 'recorded')
    await ue.keyboard('{ArrowDown}')
    expect(document.activeElement?.textContent).toBe('10Recording and snapshots')
    await ue.keyboard('{ArrowDown}')
    expect(document.activeElement?.textContent).toBe('Nothing was recorded?')
    expect(document.activeElement?.getAttribute('href')).toBe('/guide#recording--nothing-was-recorded')
    await ue.keyboard('{ArrowUp}{ArrowUp}')
    expect(document.activeElement).toBe(box)
    await ue.clear(box)
    await ue.type(box, 'nothing was{Enter}')
    await waitFor(() => expect(router.state.location.hash).toBe('recording--nothing-was-recorded'))
  })

  it('a deep link (/guide#scenarios) moves focus to that section', async () => {
    await renderApp(<GuidePage />, { path: '/#scenarios' })
    await waitFor(() => expect(document.activeElement?.id).toBe('scenarios-title'))
  })

  it('every menu sub-heading has its anchor in the article', async () => {
    await renderApp(<GuidePage />)
    const topics = GUIDE_SECTIONS.flatMap(topicsOf)
    expect(topics.length).toBeGreaterThan(20)
    for (const topic of topics) expect(document.getElementById(topic.id), topic.id).not.toBeNull()
    expect(new Set(topics.map((t) => t.id)).size).toBe(topics.length)
  })

  it('a deep link to a sub-heading moves focus to it', async () => {
    await renderApp(<GuidePage />, { path: '/#recording--nothing-was-recorded' })
    await waitFor(() => expect(document.activeElement?.id).toBe('recording--nothing-was-recorded'))
    expect(document.activeElement?.textContent).toBe('Nothing was recorded?')
  })

  it('Getting started can show the checklist again', async () => {
    window.localStorage.setItem(CHECKLIST_DISMISSED_KEY, '1')
    const { router } = await renderApp(<GuidePage />)
    await userEvent.setup().click(screen.getByRole('button', { name: 'Show the Getting started checklist' }))
    expect(window.localStorage.getItem(CHECKLIST_DISMISSED_KEY)).toBeNull()
    await waitFor(() => expect(router.state.location.pathname).toBe('/mocks'))
  })
})

describe('contextual help', () => {
  async function renderAt(path: string) {
    const root = createRootRoute({
      component: () => (
        <PrefsProvider prefs={{ theme: 'system' }} onThemeChange={() => {}}>
          <TooltipProvider>
            <HelpPanel />
            <Outlet />
          </TooltipProvider>
        </PrefsProvider>
      ),
    })
    const page = createRoute({ getParentRoute: () => root, path: '$', component: () => <main>page</main> })
    const router = createRouter({ routeTree: root.addChildren([page]), history: createMemoryHistory({ initialEntries: [path] }) })
    render(<RouterProvider router={router} />)
    await screen.findByText('page')
    return router
  }

  it.each([
    ['/requests', 'Request log and near misses', 'request-log'],
    ['/mocks/new', 'Mocks and the editor', 'mocks'],
    ['/scenarios/new', 'Scenarios and the builder', 'scenarios'],
  ])('"How this works" on %s opens the %s section with a link to the full guide', async (path, title, slug) => {
    await renderAt(path)
    const button = screen.getByRole('button', { name: 'How this works' })
    // The name stays short (it sits beside every page's own buttons); the tooltip names the section.
    expect(button.getAttribute('title')).toBe(`How this works: ${title}`)
    await userEvent.setup().click(button)
    const panel = await screen.findByRole('dialog', { name: title })
    expect(within(panel).getByRole('link', { name: 'Open the full guide' }).getAttribute('href')).toBe(`/guide#${slug}`)
    expect(within(panel).getAllByRole('heading', { level: 3 }).map((h) => h.textContent)).toEqual(['What it is', 'What it does in WireMock', 'How to', 'Tips and limits'])
  })

  it('is not shown on the guide itself or on a page no section covers', async () => {
    await renderAt('/guide')
    expect(screen.queryByRole('button', { name: /How this works/ })).toBeNull()
    cleanup()
    await renderAt('/login')
    expect(screen.queryByRole('button', { name: /How this works/ })).toBeNull()
  })

  it('a term is explained by the glossary on hover and focus', async () => {
    await renderApp(<Term name="near miss">Near misses</Term>)
    const term = screen.getByText('Near misses')
    expect(term.getAttribute('aria-description')).toMatch(/almost matched/)
    expect(term.tabIndex).toBe(0)
  })

  it('? opens the guide, but not while typing', async () => {
    function Shortcut() {
      useGuideShortcut()
      return (
        <>
          <input aria-label="field" />
          <div role="dialog" aria-label="open dialog" />
        </>
      )
    }
    const { router } = await renderApp(<Shortcut />)
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'field' }), { key: '?' })
    expect(router.state.location.pathname).toBe('/')
    // Not while a dialog is open.
    fireEvent.keyDown(document.body, { key: '?' })
    expect(router.state.location.pathname).toBe('/')
    act(() => screen.getByRole('dialog', { name: 'open dialog' }).remove())
    fireEvent.keyDown(document.body, { key: '?' })
    await waitFor(() => expect(router.state.location.pathname).toBe('/guide'))
  })
})

describe('Getting started checklist', () => {
  const mockQueries: URLSearchParams[] = []
  function api(opts: { mocks?: number; requests?: number }) {
    mockQueries.length = 0
    server.use(
      http.get(`${BASE}/api/mocks`, ({ request }) => {
        mockQueries.push(new URL(request.url).searchParams)
        return HttpResponse.json({ items: [], total: 0, totalMocks: opts.mocks ?? 0, baseline: 0, offset: 0, limit: 1 })
      }),
      http.get(`${BASE}/api/requests`, () => HttpResponse.json(Array.from({ length: opts.requests ?? 0 }, (_, i) => ({ id: `r${i}` })))),
    )
  }
  const done = () =>
    screen
      .getAllByRole('listitem')
      .filter((li) => li.hasAttribute('data-done'))
      .map((li) => li.textContent?.replace(/\(done\).*/, '').trim())

  it('starts with nothing ticked and points at the first step: a mock', async () => {
    api({})
    await renderApp(<GettingStartedChecklist />)
    await screen.findByRole('heading', { name: 'Getting started' })
    await waitFor(() => expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('0'))
    expect(screen.getByRole('link', { name: /New mock/ }).getAttribute('href')).toBe('/mocks/new')
  })

  it('ticks itself from real data: a mock, a request, and the request log once opened', async () => {
    api({ mocks: 3, requests: 1 })
    await renderApp(<GettingStartedChecklist />)
    await waitFor(() => expect(done()).toEqual(['1. Create a mock', '2. Send a test request']))
    expect(screen.getByRole('link', { name: /Open the request log/ })).toBeTruthy()
    expect(window.localStorage.getItem(REQUEST_SENT_KEY)).toBe('1')
    // The mock step counts the signed-in user's own mocks.
    expect(mockQueries.at(-1)?.get('owner')).toBe('sara')
    act(() => markRequestLogSeen('u1'))
    // All three done: it hides itself for good (until the Guide shows it again).
    await waitFor(() => expect(screen.queryByRole('heading', { name: 'Getting started' })).toBeNull())
    expect(window.localStorage.getItem(CHECKLIST_DONE_KEY)).toBe('1')
  })

  it('is dismissed per browser and comes back from the guide', async () => {
    api({})
    await renderApp(<GettingStartedChecklist />)
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Hide the Getting started checklist' }))
    expect(screen.queryByRole('heading', { name: 'Getting started' })).toBeNull()
    expect(window.localStorage.getItem(CHECKLIST_DISMISSED_KEY)).toBe('1')
    act(() => reopenChecklist('u1'))
    expect(await screen.findByRole('heading', { name: 'Getting started' })).toBeTruthy()
  })

  it('keeps its flags per user: someone else on this browser still sees their own checklist', async () => {
    api({})
    window.localStorage.setItem(checklistKey('dismissed', 'someone-else'), '1')
    window.localStorage.setItem(checklistKey('done', 'someone-else'), '1')
    await renderApp(<GettingStartedChecklist />)
    expect(await screen.findByRole('heading', { name: 'Getting started' })).toBeTruthy()
  })
})

describe('this install\'s WireMock address', () => {
  it('replaces the default address in guide examples with WIREMOCK_PUBLIC_URL', async () => {
    const { ServerConfigProvider } = await import('@/ui/config')
    render(
      <ServerConfigProvider config={{ storeDriver: 'sqlite', wiremockPublicUrl: 'https://mocks.example.test/', recordingAllowed: true, seedPrune: false }}>
        <GuideMarkdown markdown={'Call `http://localhost:8080/blog/posts/42`.'} />
      </ServerConfigProvider>,
    )
    expect(screen.getByText('https://mocks.example.test/blog/posts/42')).toBeTruthy()
  })
})

describe('docs/USAGE.md index', () => {
  it('lists every guide section, in order, with its title and file', () => {
    const usage = readFileSync(join(process.cwd(), 'docs/USAGE.md'), 'utf8')
    const rows = [...usage.matchAll(/^\| (\d+) \| \[([^\]]+)\]\(guide\/([a-z0-9-]+)\.md\) \|/gm)].map((m) => [Number(m[1]), m[2], m[3]])
    expect(rows).toEqual(GUIDE_SECTIONS.map((s, i) => [i + 1, s.title, s.slug]))
  })
})
