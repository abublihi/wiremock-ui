import { ValidationError } from '../errors'

/** At most this many tags on one mock. */
export const MAX_TAGS = 20
/** At most this many characters in one tag. */
export const MAX_TAG_LENGTH = 40

const TAG = /^[a-z0-9][a-z0-9._-]*$/

/**
 * A tag as stored: trimmed, lower case, inner spaces as `-` ("Qiwa API" → "qiwa-api"). Null when nothing usable is
 * left. Shared with the browser, which shows the same form the server will store.
 */
export function normaliseTag(raw: string): string | null {
  const tag = raw.trim().toLowerCase().replace(/\s+/g, '-')
  return tag === '' ? null : tag
}

/** Why `tag` (already normalised) cannot be stored, or undefined when it can. */
export function tagProblem(tag: string): string | undefined {
  if (tag.length > MAX_TAG_LENGTH) return `at most ${MAX_TAG_LENGTH} characters`
  if (!TAG.test(tag)) return 'only a-z, 0-9, ".", "_" and "-", starting with a letter or digit'
  return undefined
}

/**
 * A mock's tags as stored: normalised, duplicates dropped, first-seen order kept. Undefined for none. Throws a
 * ValidationError naming `field` for anything else than a list of usable tag strings.
 */
export function normaliseTags(value: unknown, field = 'metadata.wiremockUi.tags'): string[] | undefined {
  if (value === undefined || value === null) return undefined
  if (!Array.isArray(value)) throw new ValidationError(`${field} must be a list of strings`)
  const out: string[] = []
  for (const raw of value) {
    if (typeof raw !== 'string') throw new ValidationError(`${field} must be a list of strings`)
    const tag = normaliseTag(raw)
    if (tag === null) continue
    const problem = tagProblem(tag)
    if (problem) throw new ValidationError(`${field}: "${raw}" is not a usable tag (${problem})`)
    if (!out.includes(tag)) out.push(tag)
  }
  if (out.length > MAX_TAGS) throw new ValidationError(`${field} must hold at most ${MAX_TAGS} tags`)
  return out.length > 0 ? out : undefined
}

/** The tags a stored mock carries (empty when none). */
export const tagsOf = (stub: { metadata?: { wiremockUi?: { tags?: unknown } } }): string[] => {
  const tags = stub.metadata?.wiremockUi?.tags
  return Array.isArray(tags) ? tags.filter((t): t is string => typeof t === 'string') : []
}
