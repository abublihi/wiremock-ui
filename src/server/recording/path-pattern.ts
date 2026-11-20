/**
 * The recording filter "Paths to record". WireMock's `filters.urlPathPattern` is a regular expression matched against
 * the whole request path (no query string), so `/api/*` (as a regex: "/api followed by slashes") or
 * `api/Products?limit=3` record nothing. People type wildcards, and people who know WireMock type regexes, so by
 * default ("auto") the value is read as a regex when it uses regex-only syntax and as a wildcard otherwise; a manual
 * mode overrides that. Pure: the Recording page shows the same reading, conversion and warnings before anything is
 * sent.
 */

export const PATH_MODES = ['auto', 'wildcard', 'regex'] as const
export type PathMode = (typeof PATH_MODES)[number]

/** Characters a wildcard treats literally that mean something in a regex (`*` is handled on its own). */
const REGEX_SPECIAL = /[\\^$.+?()[\]{}|]/g

/**
 * Regex-only syntax: `.*`, `.+`, a backslash, `^` at the start, `$` at the end, `[`, `(`, `|` or a `{n}` / `{n,m}`
 * count. A wildcard pattern never needs any of these.
 */
export function looksLikeRegex(text: string): boolean {
  const p = text.trim()
  return /\.\*|\.\+|\\|\[|\(|\||\{\d+(,\d*)?\}/.test(p) || p.startsWith('^') || p.endsWith('$')
}

export type WildcardResult = {
  /** The regular expression sent to WireMock (anchored: the whole path must match). */
  regex: string
  /** A `?query` part that was typed and left out (the query string is not part of the path). */
  droppedQuery?: string
  /** The pattern did not start with `/` (or `*`), so one was put in front. */
  addedSlash: boolean
  /** The paths it matches, for people: `*` shown as `…` (`/api/…`). */
  example: string
}

/** `/api/*` → `^/api/.*$`; `*` is "anything", every other character means itself. */
export function wildcardToRegex(text: string): WildcardResult {
  let path = text.trim()
  let droppedQuery: string | undefined
  const q = path.indexOf('?')
  if (q !== -1) {
    droppedQuery = path.slice(q)
    path = path.slice(0, q)
  }
  const addedSlash = path !== '' && !path.startsWith('/') && !path.startsWith('*')
  if (addedSlash) path = `/${path}`
  const body = path
    .split('*')
    .map((part) => part.replace(REGEX_SPECIAL, (c) => `\\${c}`))
    .join('.*')
  return { regex: `^${body}$`, ...(droppedQuery ? { droppedQuery } : {}), addedSlash, example: path.replaceAll('*', '…') }
}

export type RegexProblem = {
  kind: 'query' | 'start'
  /** A regex that would record what was probably meant: the path part, from its leading /, then anything. */
  suggestion: string
}

/**
 * A regex that cannot match any path: it has a query string (`?…=`), or it starts with a plain character (a path
 * always starts with `/`, and WireMock matches the whole path). Null when it looks fine.
 */
export function regexProblem(pattern: string): RegexProblem | null {
  const p = pattern.trim()
  if (p === '') return null
  // A `?` with an `=` somewhere after it (indexOf, not a regex: linear on any input).
  const q = p.indexOf('?')
  const query = q !== -1 && p.indexOf('=', q) !== -1
  const start = /^[A-Za-z0-9_~%-]/.test(p)
  if (!query && !start) return null
  let path = query ? p.slice(0, q) : p
  path = path.replace(/^\^/, '')
  if (!path.startsWith('/') && !path.startsWith('.')) path = `/${path}`
  const suggestion = /\.\*\$?$/.test(path) ? path : `${path.replace(/\$$/, '')}.*`
  return { kind: query ? 'query' : 'start', suggestion }
}

/** What was typed, as a path (leading `^` dropped, a leading `/` put back), for messages. */
export function typedAsPath(pattern: string): string {
  const p = pattern.trim().replace(/^\^/, '')
  return p.startsWith('/') ? p : `/${p}`
}

/** The message the API answers (400) for a regex that cannot match a path. */
export function regexProblemMessage(problem: RegexProblem, pattern: string): string {
  const what =
    problem.kind === 'query'
      ? 'urlPathPattern matches the path only, without the query string'
      : 'urlPathPattern must match the whole path, which starts with /'
  return `${what}. To record ${typedAsPath(pattern)} use ${problem.suggestion}`
}

export type PathFilter = ({ kind: 'wildcard' } & WildcardResult) | { kind: 'regex'; regex: string; problem: RegexProblem | null }

/** How "Paths to record" is read in `mode` (auto: a regex when it uses regex-only syntax), and what WireMock gets. */
export function resolvePathFilter(text: string, mode: PathMode = 'auto'): PathFilter {
  const regex = mode === 'regex' || (mode === 'auto' && looksLikeRegex(text))
  if (regex) return { kind: 'regex', regex: text.trim(), problem: regexProblem(text) }
  return { kind: 'wildcard', ...wildcardToRegex(text) }
}
