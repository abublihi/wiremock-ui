import { ValidationError } from '../errors'
import type { StubMapping } from '../wiremock/types'

/**
 * Bundle shapes without any Node import: the server's import/seed code and the browser's Import page share them,
 * so a file the preview accepts is a file the server accepts.
 */
export type Bundle = {
  integrations: unknown[]
  catalog: unknown[]
  mocks: StubMapping[]
  oidcIdentities: unknown[]
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const BUNDLE_KEYS = ['integrations', 'catalog', 'mocks', 'oidcIdentities'] as const

export const emptyBundle = (): Bundle => ({ integrations: [], catalog: [], mocks: [], oidcIdentities: [] })

function list(value: unknown, field: string, source: string): unknown[] {
  if (value === undefined) return []
  if (!Array.isArray(value)) throw new ValidationError(`${source}: ${field} must be an array`)
  return value
}

/** Accepts a bundle, a WireMock export ({ mappings }), a single stub or an array of stubs. */
export function parseBundle(json: unknown, source: string): Bundle {
  if (Array.isArray(json)) return { ...emptyBundle(), mocks: json as StubMapping[] }
  if (isObject(json)) {
    if (BUNDLE_KEYS.some((k) => k in json)) {
      return {
        integrations: list(json.integrations, 'integrations', source),
        catalog: list(json.catalog, 'catalog', source),
        mocks: list(json.mocks, 'mocks', source) as StubMapping[],
        oidcIdentities: list(json.oidcIdentities, 'oidcIdentities', source),
      }
    }
    if ('mappings' in json) return { ...emptyBundle(), mocks: list(json.mappings, 'mappings', source) as StubMapping[] }
    if (isObject(json.request) && isObject(json.response)) return { ...emptyBundle(), mocks: [json as StubMapping] }
  }
  throw new ValidationError(`${source}: unrecognised bundle shape (expected a bundle, a WireMock export, a stub or an array of stubs)`)
}

/** Appends `part` to `into` (in place) and returns it. */
export function mergeInto(into: Bundle, part: Bundle): Bundle {
  into.integrations.push(...part.integrations)
  into.catalog.push(...part.catalog)
  into.mocks.push(...part.mocks)
  into.oidcIdentities.push(...part.oidcIdentities)
  return into
}

/** Plain code-unit order, the same on every platform (SEED_PATH folders and the Import page both use it). */
export const byPath = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0)
