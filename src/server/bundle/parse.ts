import { readdir, readFile, realpath, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { ValidationError } from '../errors'
import type { StubMapping } from '../wiremock/types'

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

async function jsonFiles(dir: string, rel = '', seen = new Set<string>()): Promise<string[]> {
  const real = await realpath(join(dir, rel))
  if (seen.has(real)) return []
  seen.add(real)
  const entries = await readdir(join(dir, rel), { withFileTypes: true })
  const out: string[] = []
  for (const e of entries) {
    if (e.name.startsWith('.')) continue
    const path = rel ? `${rel}/${e.name}` : e.name
    // Dirents use lstat; follow symlinks (e.g. Kubernetes ConfigMap volumes) with stat.
    const info = e.isSymbolicLink() ? await stat(join(dir, path)).catch(() => null) : e
    if (!info) continue
    if (info.isDirectory()) out.push(...(await jsonFiles(dir, path, seen)))
    else if (info.isFile() && e.name.endsWith('.json')) out.push(path)
  }
  return out
}

async function readFileBundle(path: string, label: string): Promise<Bundle> {
  let json: unknown
  try {
    json = JSON.parse(await readFile(path, 'utf8'))
  } catch (err) {
    throw new ValidationError(`${label}: ${err instanceof SyntaxError ? 'invalid JSON' : (err as Error).message}`)
  }
  return parseBundle(json, label)
}

/** A file, or a folder whose *.json files (recursively, sorted by relative path) are merged. */
export async function readBundleFromPath(path: string): Promise<Bundle> {
  const info = await stat(path).catch(() => null)
  if (!info) throw new ValidationError(`${path}: no such file or folder`)
  if (!info.isDirectory()) return readFileBundle(path, path)
  const merged = emptyBundle()
  const files = (await jsonFiles(path)).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
  if (files.length === 0) throw new ValidationError(`SEED_PATH ${path} contains no .json files`)
  for (const rel of files) {
    const part = await readFileBundle(join(path, rel), join(path, rel))
    merged.integrations.push(...part.integrations)
    merged.catalog.push(...part.catalog)
    merged.mocks.push(...part.mocks)
    merged.oidcIdentities.push(...part.oidcIdentities)
  }
  return merged
}
