/**
 * The in-app guide. Its text lives as Markdown in `docs/guide/*.md` (one file per section, so the repository docs and
 * the app never drift); each file starts with front-matter:
 *
 *   ---
 *   title: Scenarios and the builder
 *   order: 7
 *   routes: /scenarios
 *   summary: One line for the table of contents and the help panel.
 *   ---
 *
 * `routes` (comma-separated path prefixes) is where the page header's "How this works" panel shows this section.
 */

export type GuideSection = {
  /** The file name without `.md`: the section's anchor (`/guide#scenarios`). */
  slug: string
  title: string
  order: number
  routes: string[]
  summary: string
  /** The Markdown after the front-matter. */
  body: string
}

/** Splits a guide file into its front-matter fields and body. Unknown or malformed front-matter is an error. */
export function parseGuideFile(slug: string, source: string): GuideSection {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(source)
  if (!match) throw new Error(`docs/guide/${slug}.md: missing front-matter`)
  const fields: Record<string, string> = {}
  for (const line of match[1].split(/\r?\n/)) {
    if (line.trim() === '') continue
    const colon = line.indexOf(':')
    if (colon === -1) throw new Error(`docs/guide/${slug}.md: bad front-matter line "${line}"`)
    fields[line.slice(0, colon).trim()] = line.slice(colon + 1).trim()
  }
  const order = Number(fields.order)
  if (!fields.title || !Number.isFinite(order)) throw new Error(`docs/guide/${slug}.md: title and order are required`)
  return {
    slug,
    title: fields.title,
    order,
    routes: (fields.routes ?? '')
      .split(',')
      .map((r) => r.trim())
      .filter(Boolean),
    summary: fields.summary ?? '',
    // The file's own `# Title` (for reading it on GitHub) is the section heading in the app.
    body: match[2].trim().replace(/^# .*(\r?\n)+/, ''),
  }
}

/** Every `docs/guide/*.md` file, read at build time. */
const FILES = import.meta.glob('../../../docs/guide/*.md', { query: '?raw', import: 'default', eager: true }) as Record<string, string>

export function sectionsFrom(files: Record<string, string>): GuideSection[] {
  // An empty glob means docs/guide was left out of the build (a .dockerignore or a partial checkout): fail the build
  // loudly instead of shipping a Guide page with no sections.
  if (Object.keys(files).length === 0) throw new Error('docs/guide/*.md: no guide sections found; the build needs the docs/guide folder')
  return Object.entries(files)
    .map(([path, source]) => parseGuideFile(path.replace(/^.*\//, '').replace(/\.md$/, ''), source))
    .sort((a, b) => a.order - b.order || a.slug.localeCompare(b.slug))
}

export const GUIDE_SECTIONS: GuideSection[] = sectionsFrom(FILES)

export function guideSection(slug: string): GuideSection | undefined {
  return GUIDE_SECTIONS.find((s) => s.slug === slug)
}

/**
 * The section for a page: the one whose route is the longest prefix of `pathname` (`/scenarios/new`
 * → Scenarios). Undefined when no section names the page.
 */
export function sectionForPath(pathname: string, sections: GuideSection[] = GUIDE_SECTIONS): GuideSection | undefined {
  let best: { section: GuideSection; length: number } | undefined
  for (const section of sections) {
    for (const route of section.routes) {
      const hit = pathname === route || pathname.startsWith(route.endsWith('/') ? route : `${route}/`)
      if (hit && (!best || route.length > best.length)) best = { section, length: route.length }
    }
  }
  return best?.section
}

/** `Nothing was recorded?` → `nothing-was-recorded`. */
export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

/** A heading inside a section the side menu can jump to: its anchor (`recording--nothing-was-recorded`) and text. */
export type GuideTopic = { id: string; text: string }

export const topicId = (slug: string, text: string) => `${slug}--${slugify(text)}`

/** Text that starts a paragraph in bold and ends in `.` or `?` ("**Build a scenario.**"): a task heading. */
export const LEAD_IN = /^\*\*([^*\n]+?[.?])\*\*/

/**
 * A section's sub-headings for the side menu: its `###` headings and the bold lead-ins that start a task
 * ("**Add an integration.**", "**Why didn't my mock match?**"), in order. The four headings every section shares
 * (What it is, How to…) are left out.
 */
export function topicsOf(section: GuideSection): GuideTopic[] {
  const topics: GuideTopic[] = []
  let fence = false
  for (const line of section.body.split(/\r?\n/)) {
    if (line.startsWith('```')) fence = !fence
    if (fence) continue
    const heading = /^### (.+)$/.exec(line)?.[1] ?? LEAD_IN.exec(line)?.[1]
    if (!heading) continue
    const text = heading.replace(/[.]$/, '').trim()
    topics.push({ id: topicId(section.slug, text), text })
  }
  return topics
}

export type MenuEntry = { section: GuideSection; titleMatch: boolean; topics: GuideTopic[] }

/**
 * The side menu for a query: every section when it is empty; otherwise the sections whose title matches, or that
 * have a sub-heading that does, with just the matching sub-headings (case-insensitive). Body text is not searched.
 */
export function filterMenu(query: string, sections: GuideSection[] = GUIDE_SECTIONS): MenuEntry[] {
  const q = query.trim().toLowerCase()
  if (q === '') return sections.map((section) => ({ section, titleMatch: false, topics: [] }))
  return sections.flatMap((section) => {
    const titleMatch = section.title.toLowerCase().includes(q)
    const topics = topicsOf(section).filter((t) => t.text.toLowerCase().includes(q))
    return titleMatch || topics.length > 0 ? [{ section, titleMatch, topics }] : []
  })
}

/**
 * Where a link in the guide goes inside the app: `scenarios.md#steps` → `/guide#scenarios`, `/requests` → that
 * page, anything else (http, mailto) stays external. Links are already through react-markdown's URL check, so
 * `javascript:` and friends never get here.
 */
export function guideHref(href: string): { kind: 'guide'; hash: string } | { kind: 'app'; to: string; hash?: string } | { kind: 'external'; href: string } {
  // `scenarios.md#build-a-scenario` → the topic inside that section (`scenarios--build-a-scenario`).
  const md = /^(?:\.\/)?([a-z0-9-]+)\.md(?:#(.*))?$/.exec(href)
  if (md) return { kind: 'guide', hash: md[2] ? `${md[1]}--${md[2]}` : md[1] }
  if (href.startsWith('#')) return { kind: 'guide', hash: href.slice(1) }
  if (href.startsWith('/') && !href.startsWith('//')) {
    const [path, hash] = href.split('#')
    return { kind: 'app', to: path, ...(hash ? { hash } : {}) }
  }
  return { kind: 'external', href }
}

/**
 * The Glossary section's table rows as term → meaning (lower case; "Stub / stub mapping / mapping" gives three
 * terms), so tooltips in the app read the same definitions as the guide.
 */
export function glossaryFrom(sections: GuideSection[]): Map<string, string> {
  const terms = new Map<string, string>()
  const body = sections.find((s) => s.slug === 'glossary')?.body ?? ''
  for (const line of body.split(/\r?\n/)) {
    const cells = /^\|\s*(.+?)\s*\|\s*(.+?)\s*\|$/.exec(line)
    if (!cells || !cells[1].includes('**')) continue
    const meaning = cells[2].replace(/`/g, '').replace(/\*\*/g, '')
    for (const term of cells[1].replace(/\*\*/g, '').split('/')) terms.set(term.trim().toLowerCase(), meaning)
  }
  return terms
}

export const GLOSSARY = glossaryFrom(GUIDE_SECTIONS)

/**
 * The Getting started checklist's flags, remembered in this browser per user (someone else signing in on the same
 * browser starts with their own): `dismissed`; `requestLogSeen` (the request log showed a request, the last step);
 * `requestSent` (WireMock has had a request, so clearing the log later does not untick the step); `done` (all five
 * steps done: the checklist hides itself and stops asking the server).
 */
export type ChecklistFlag = 'dismissed' | 'requestLogSeen' | 'requestSent' | 'done'
export const checklistKey = (flag: ChecklistFlag, userId: string) => `wmui.checklist.${userId}.${flag}`
