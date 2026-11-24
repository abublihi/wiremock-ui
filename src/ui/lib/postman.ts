import type { Bundle } from '@/server/bundle/shape'
import type { StubMapping } from '@/server/wiremock/types'
import type { MessageKey } from '@/ui/i18n'
import { legacyEndpointsOf, migrateLinkedStubs } from '@/server/catalog/migrate'

/*
 * Postman Collection v2.0 / v2.1 → mocks tagged with the collection (postmanBundle), as an import bundle.
 * Pure (no DOM, no dependencies): the Import page and the server tests both use it.
 */

/** A message the page translates. */
export type PostmanNote = { key: MessageKey; params: Record<string, string | number> }

export type BodyKind = 'json' | 'xml' | 'html' | 'text' | 'form'

/** A request as the mapping needs it: the path WireMock sees, its query, headers and body. */
export type PmRequestInfo = {
  method: string
  /** Absolute path without host or query; `:id` and whole-segment `{{id}}` become `{id}`. */
  path: string
  /** Values of the path variables (from `url.variable`), by name. */
  pathVars: Record<string, string>
  query: [string, string][]
  /** Header names in lower case. */
  headers: Record<string, string>
  body?: { kind: BodyKind; text: string }
}

export type PmExample = {
  id: string
  name: string
  status: number
  contentType?: string
  body: string
  /** The example's `originalRequest`, when it has one. */
  request?: PmRequestInfo
}

export type PmRequest = {
  id: string
  name: string
  /** Folder names from the collection root. */
  folder: string[]
  description?: string
  request: PmRequestInfo
  examples: PmExample[]
  notes: PostmanNote[]
}

export type PostmanCollection = {
  name: string
  description?: string
  requests: PmRequest[]
  /** Collection-wide notes (auth helpers, scripts) and requests that could not be used. */
  warnings: PostmanNote[]
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined)

const SCHEMA = /collection\/v2\.[01]\.0/

/** A Postman Collection v2.0.0 or v2.1.0 (by its `info.schema`). */
export function isPostmanCollection(json: unknown): boolean {
  return isObject(json) && isObject(json.info) && typeof json.info.schema === 'string' && SCHEMA.test(json.info.schema)
}

/** Deeper folders make the collection unreadable (and would exhaust the stack). */
export const MAX_FOLDER_DEPTH = 64

export const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'] as const

/* ---------- Parsing ---------- */

function description(v: unknown): string | undefined {
  const text = isObject(v) ? str(v.content) : str(v)
  const trimmed = text?.trim()
  return trimmed ? trimmed : undefined
}

/** Headers as an array of { key, value, disabled } or (v2.0) a "Name: value" text block. */
function headersOf(v: unknown): Record<string, string> {
  const out: Record<string, string> = {}
  if (typeof v === 'string') {
    for (const line of v.split(/\r?\n/)) {
      const at = line.indexOf(':')
      if (at > 0) out[line.slice(0, at).trim().toLowerCase()] = line.slice(at + 1).trim()
    }
  } else if (Array.isArray(v)) {
    for (const h of v) {
      if (!isObject(h) || h.disabled === true) continue
      const key = str(h.key)?.trim()
      if (key) out[key.toLowerCase()] = str(h.value) ?? ''
    }
  }
  return out
}

function pairs(v: unknown): [string, string][] {
  if (!Array.isArray(v)) return []
  const out: [string, string][] = []
  for (const p of v) {
    if (!isObject(p) || p.disabled === true || p.type === 'file') continue
    const key = str(p.key)
    if (key) out.push([key, str(p.value) ?? ''])
  }
  return out
}

const formText = (fields: [string, string][]) => fields.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&')

function sniff(text: string): BodyKind {
  const t = text.trim()
  if (t.startsWith('{') || t.startsWith('[')) {
    try {
      JSON.parse(t)
      return 'json'
    } catch {
      return 'text'
    }
  }
  if (/^<!doctype html|^<html[\s>]/i.test(t)) return 'html'
  if (t.startsWith('<')) return 'xml'
  return 'text'
}

/** The kind a Content-Type names, if it names one. */
export function kindOfContentType(contentType: string | undefined): BodyKind | undefined {
  if (!contentType) return undefined
  const ct = contentType.toLowerCase()
  if (ct.includes('json')) return 'json'
  if (ct.includes('html')) return 'html'
  if (ct.includes('xml')) return 'xml'
  if (ct.includes('x-www-form-urlencoded') || ct.includes('multipart/form-data')) return 'form'
  if (ct.startsWith('text/')) return 'text'
  return undefined
}

function bodyOf(v: unknown, headers: Record<string, string>, notes: PostmanNote[], name: string): PmRequestInfo['body'] {
  if (!isObject(v) || v.disabled === true) return undefined
  const mode = str(v.mode)
  if (mode === 'raw') {
    const text = str(v.raw) ?? ''
    if (text === '') return undefined
    const options = isObject(v.options) && isObject(v.options.raw) ? v.options.raw : {}
    const language = str(options.language)
    const declared = kindOfContentType(headers['content-type'])
    const kind: BodyKind =
      language === 'json' ? 'json' : language === 'xml' ? 'xml' : language === 'html' ? 'html' : declared && declared !== 'form' ? declared : sniff(text)
    return { kind, text }
  }
  if (mode === 'urlencoded') {
    const fields = pairs(v.urlencoded)
    return fields.length ? { kind: 'form', text: formText(fields) } : undefined
  }
  if (mode === 'formdata') {
    const fields = pairs(v.formdata)
    return fields.length ? { kind: 'form', text: formText(fields) } : undefined
  }
  if (mode === 'graphql') notes.push({ key: 'postman.noteGraphql', params: { name } })
  else if (mode === 'file') notes.push({ key: 'postman.noteFileBody', params: { name } })
  return undefined
}

type Vars = Map<string, string>

/** A Postman path variable or collection variable name as a WireMock path-template name. */
const templateName = (name: string) => name.replace(/[^A-Za-z0-9_]/g, '_') || 'param'

function segmentsOfRaw(raw: string): string[] {
  let rest = raw.trim().replace(/#.*$/, '').replace(/\?.*$/, '')
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(rest)) rest = rest.replace(/^[a-z][a-z0-9+.-]*:\/\/[^/]*/i, '')
  else if (rest.startsWith('{{')) rest = rest.replace(/^\{\{[^}]*\}\}/, '')
  else if (!rest.startsWith('/')) rest = rest.includes('/') ? rest.slice(rest.indexOf('/')) : ''
  return rest.split('/')
}

function queryOfRaw(raw: string): [string, string][] {
  const at = raw.indexOf('?')
  if (at < 0) return []
  const out: [string, string][] = []
  for (const part of raw.slice(at + 1).replace(/#.*$/, '').split('&')) {
    if (!part) continue
    const eq = part.indexOf('=')
    const decode = (s: string) => {
      try {
        return decodeURIComponent(s.replace(/\+/g, ' '))
      } catch {
        return s
      }
    }
    out.push(eq < 0 ? [decode(part), ''] : [decode(part.slice(0, eq)), decode(part.slice(eq + 1))])
  }
  return out
}

/** Turns Postman path segments into a path: `:id` → `{id}`, `{{var}}` → its collection value or `{var}`. */
function pathOf(segments: string[], vars: Vars, notes: PostmanNote[], name: string): string {
  const out: string[] = []
  for (const seg of segments) {
    if (seg === '') continue
    if (/^:[^/]+$/.test(seg)) {
      out.push(`{${templateName(seg.slice(1))}}`)
      continue
    }
    const whole = /^\{\{([^{}]+)\}\}$/.exec(seg)
    if (whole && !vars.has(whole[1])) {
      notes.push({ key: 'postman.noteUnresolved', params: { name, variable: whole[1] } })
      out.push(`{${templateName(whole[1])}}`)
      continue
    }
    out.push(
      seg.replace(/\{\{([^{}]+)\}\}/g, (_m, v: string) => {
        if (vars.has(v)) return vars.get(v)!
        notes.push({ key: 'postman.noteUnresolved', params: { name, variable: v } })
        return v
      }),
    )
  }
  const trailing = segments.length > 1 && segments[segments.length - 1] === '' && out.length > 0
  const path = `/${out.join('/')}${trailing ? '/' : ''}`
  return path.replace(/\/{2,}/g, '/')
}

function requestInfo(v: unknown, vars: Vars, notes: PostmanNote[], name: string): PmRequestInfo {
  const r = typeof v === 'string' ? { url: v } : isObject(v) ? v : {}
  const method = (str(r.method) ?? 'GET').toUpperCase()
  const headers = headersOf(r.header)
  const url = r.url
  let segments: string[] = []
  let query: [string, string][] = []
  const pathVars: Record<string, string> = {}
  if (typeof url === 'string') {
    segments = segmentsOfRaw(url)
    query = queryOfRaw(url)
  } else if (isObject(url)) {
    if (Array.isArray(url.path)) {
      segments = url.path.map((s) => (typeof s === 'string' ? s : isObject(s) ? (str(s.value) ?? '') : ''))
      // A trailing slash shows up only in the raw URL.
      const raw = str(url.raw)?.replace(/[?#].*$/, '')
      if (raw?.endsWith('/') && segments.length > 0) segments.push('')
    } else if (typeof url.path === 'string') segments = url.path.split('/')
    else if (typeof url.raw === 'string') segments = segmentsOfRaw(url.raw)
    query = Array.isArray(url.query) ? pairs(url.query) : typeof url.raw === 'string' ? queryOfRaw(url.raw) : []
    if (Array.isArray(url.variable)) {
      for (const p of url.variable) {
        if (!isObject(p)) continue
        const key = str(p.key) ?? str(p.id)
        if (key) pathVars[templateName(key)] = str(p.value) ?? String(p.value ?? '')
      }
    }
  }
  return { method, path: pathOf(segments, vars, notes, name), pathVars, query, headers, body: bodyOf(r.body, headers, notes, name) }
}

const hasScripts = (events: unknown) =>
  Array.isArray(events) &&
  events.some((e) => {
    if (!isObject(e) || !isObject(e.script)) return false
    const exec = e.script.exec
    const lines = Array.isArray(exec) ? exec : [exec]
    return lines.some((l) => typeof l === 'string' && l.trim() !== '')
  })
const hasAuth = (auth: unknown) => isObject(auth) && typeof auth.type === 'string' && auth.type !== 'noauth'

/** Reads a collection. Throws on anything that is not a v2.0/v2.1 collection. */
export function parsePostman(json: unknown): PostmanCollection {
  if (!isPostmanCollection(json)) throw new Error('not a Postman Collection v2.0 or v2.1')
  const root = json as Record<string, unknown>
  const info = root.info as Record<string, unknown>
  const vars: Vars = new Map()
  if (Array.isArray(root.variable)) {
    for (const v of root.variable) {
      if (isObject(v) && typeof v.key === 'string' && v.disabled !== true && v.value !== undefined && v.value !== null && String(v.value) !== '') {
        vars.set(v.key, String(v.value))
      }
    }
  }
  const warnings: PostmanNote[] = []
  let auth = hasAuth(root.auth)
  let scripts = hasScripts(root.event)
  const requests: PmRequest[] = []
  let n = 0

  const walk = (items: unknown, folder: string[]) => {
    if (!Array.isArray(items)) return
    if (folder.length > MAX_FOLDER_DEPTH) throw new Error(`folders are nested more than ${MAX_FOLDER_DEPTH} deep`)
    for (const item of items) {
      if (!isObject(item)) continue
      const itemName = str(item.name)?.trim() ?? ''
      if (hasScripts(item.event)) scripts = true
      if (hasAuth(item.auth)) auth = true
      if (Array.isArray(item.item)) {
        walk(item.item, [...folder, itemName || '(folder)'])
        continue
      }
      if (item.request === undefined) continue
      const notes: PostmanNote[] = []
      const id = `r${n++}`
      const label = itemName || `request ${n}`
      const request = requestInfo(item.request, vars, notes, label)
      if (isObject(item.request) && hasAuth(item.request.auth)) auth = true
      if (!(METHODS as readonly string[]).includes(request.method)) {
        warnings.push({ key: 'postman.warnMethod', params: { name: label, method: request.method } })
      }
      const examples: PmExample[] = []
      const responses = Array.isArray(item.response) ? item.response : []
      responses.forEach((res, i) => {
        if (!isObject(res)) return
        const exName = str(res.name)?.trim() || `example ${i + 1}`
        const status = typeof res.code === 'number' ? res.code : Number(res.code)
        if (!Number.isInteger(status) || status < 100 || status > 599) {
          notes.push({ key: 'postman.noteBadStatus', params: { name: label, example: exName } })
          return
        }
        const headers = headersOf(res.header)
        // The original request repeats the request's own notes (graphql, variables): keep those once.
        const original = res.originalRequest === undefined ? undefined : requestInfo(res.originalRequest, vars, [], label)
        examples.push({
          id: `${id}e${i}`,
          name: exName,
          status,
          contentType: headers['content-type'],
          body: typeof res.body === 'string' ? res.body : '',
          request: original,
        })
      })
      const unique = new Set<string>()
      requests.push({
        id,
        name: itemName,
        folder,
        description: description(isObject(item.request) ? item.request.description : undefined) ?? description(item.description),
        request,
        examples,
        notes: notes.filter((note) => {
          const k = `${note.key}|${JSON.stringify(note.params)}`
          return unique.has(k) ? false : (unique.add(k), true)
        }),
      })
    }
  }
  walk(root.item, [])
  if (auth) warnings.push({ key: 'postman.warnAuth', params: {} })
  if (scripts) warnings.push({ key: 'postman.warnScripts', params: {} })
  return { name: str(info.name)?.trim() || 'Postman collection', description: description(info.description), requests, warnings }
}

/* ---------- Mapping ---------- */

const KEY = /^[a-z0-9][a-z0-9-]{0,62}$/

/** A catalog key: lower-case words joined by `-`, at most 63 characters. */
export function slugify(text: string, fallback = 'item'): string {
  const slug = text
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 63)
    .replace(/-+$/, '')
  return slug || fallback
}

export const isCatalogKey = (key: string) => KEY.test(key)

/** The same rules the server applies to an integration prefix; undefined when it is fine. */
export function prefixProblem(prefix: string): MessageKey | undefined {
  if (!prefix.startsWith('/')) return 'postman.prefixSlash'
  if (prefix !== '/' && prefix.endsWith('/')) return 'postman.prefixTrailing'
  if (/[?#{}\s]/.test(prefix)) return 'postman.prefixChars'
  return undefined
}

/** `key`, or `key-2`, `key-3`… the first one not taken (kept within 63 characters). */
export function uniqueKey(key: string, taken: Set<string>): string {
  if (!taken.has(key)) return key
  for (let n = 2; ; n++) {
    const suffix = `-${n}`
    const candidate = `${key.slice(0, 63 - suffix.length).replace(/-+$/, '')}${suffix}`
    if (!taken.has(candidate)) return candidate
  }
}

/** Requests the mapping can turn into endpoints (a method the catalog knows). */
export const usableRequests = (c: PostmanCollection) => c.requests.filter((r) => (METHODS as readonly string[]).includes(r.request.method))

/** `/seg` when every request's path starts with that same literal segment and goes on after it. */
export function commonFirstSegment(c: PostmanCollection): string | undefined {
  const paths = usableRequests(c).map((r) => r.request.path)
  if (paths.length === 0) return undefined
  const first = (p: string) => /^\/([^/{}]+)\/./.exec(p)?.[1]
  const seg = first(paths[0])
  return seg && paths.every((p) => first(p) === seg) ? `/${seg}` : undefined
}

/** The integration the page starts with: key, name and prefix from the collection's name. */
export function defaultIntegration(c: PostmanCollection): IntegrationFields {
  const key = slugify(c.name, 'postman')
  return { key, name: c.name, prefix: `/${key}` }
}

/** The example a new endpoint answers with by default: the first 2xx, else the first. */
export const defaultExampleOf = (r: PmRequest) => (r.examples.find((e) => e.status >= 200 && e.status < 300) ?? r.examples[0])?.id

export type IntegrationFields = { key: string; name: string; prefix: string; description?: string }
export type RowAction = 'skip' | 'create' | 'overwrite'
export type RowChoice = { action?: RowAction; defaultExample?: string }

export type PlanOptions = {
  integration: IntegrationFields
  /** The stored integration with that key, when there is one (its name and prefix are kept). */
  existing?: { integration: IntegrationFields; endpointKeys: string[] }
  choices?: Record<string, RowChoice>
}

export type SkippedExample = { name: string; reason: MessageKey }

export type PlanRow = {
  id: string
  request: PmRequest
  method: string
  /** The endpoint path (under the prefix). */
  path: string
  /** The URL WireMock matches: prefix + path. */
  url: string
  name: string
  /** The key from the request name, unique within the collection. */
  proposedKey: string
  /** The key the endpoint is imported with. */
  key: string
  conflict: boolean
  action: RowAction
  defaultExample?: string
  mocks: number
  skipped: SkippedExample[]
}

export type Plan = {
  integration: IntegrationFields
  /** True when the endpoints go into an integration that already exists. */
  addsToExisting: boolean
  rows: PlanRow[]
  bundle: Bundle
  endpoints: number
  mocks: number
}

type ContentType = 'json' | 'xml' | 'text' | 'html'
// Keep in step with the server builder (src/server/catalog/build.ts): the default mock must read back in Simple mode.
const MIME: Record<ContentType, string> = {
  json: 'application/json',
  xml: 'application/xml',
  text: 'text/plain; charset=utf-8',
  html: 'text/html; charset=utf-8',
}

const isJson = (text: string) => {
  try {
    JSON.parse(text)
    return true
  } catch {
    return false
  }
}

/** The endpoint's content type: the default example's Content-Type, else its body, else the request's. */
function contentTypeOf(r: PmRequest, example: PmExample | undefined): ContentType {
  const asType = (k: BodyKind | undefined): ContentType | undefined => (k === 'form' ? undefined : k)
  if (example) {
    const declared = asType(kindOfContentType(example.contentType))
    if (declared) return declared
    if (example.body.trim() !== '') return asType(sniff(example.body)) ?? 'text'
  }
  for (const e of r.examples) {
    const declared = asType(kindOfContentType(e.contentType))
    if (declared) return declared
  }
  return asType(r.request.body?.kind) ?? 'json'
}

/** The endpoint path under `prefix`: the request path with the prefix taken off when it starts with it. */
export function pathUnder(prefix: string, path: string): string {
  if (prefix === '/') return path
  if (path.startsWith(`${prefix}/`)) return path.slice(prefix.length)
  return path
}

const canonicalOf = (v: unknown): string =>
  Array.isArray(v)
    ? `[${v.map(canonicalOf).join(',')}]`
    : isObject(v)
      ? `{${Object.keys(v)
          .sort()
          .map((k) => `${JSON.stringify(k)}:${canonicalOf(v[k])}`)
          .join(',')}}`
      : JSON.stringify(v)

/** Key-order-free JSON text; undefined when the value is too deep to walk. */
function canonical(v: unknown): string | undefined {
  try {
    return canonicalOf(v)
  } catch {
    return undefined
  }
}

/** JSON text re-indented, or the text as it is when it cannot be. */
function pretty(text: string): string {
  try {
    return JSON.stringify(JSON.parse(text), null, 2)
  } catch {
    return text
  }
}

const formFields = (text: string): Map<string, string> => new Map(queryOfRaw(`?${text}`))

/** The matchers that tell `variant` apart from `reference`: JSON body, form fields, query and path parameters. */
function distinguishing(variant: PmRequestInfo, reference: PmRequestInfo, templateVars: Set<string>): Record<string, unknown> {
  const extra: Record<string, unknown> = {}
  const vb = variant.body
  const rb = reference.body
  if (vb?.kind === 'json' && isJson(vb.text)) {
    const a = rb?.kind === 'json' && isJson(rb.text) ? canonical(JSON.parse(rb.text)) : undefined
    const b = canonical(JSON.parse(vb.text))
    // Too deep to compare: compare the text instead.
    const same = rb !== undefined && (a !== undefined && b !== undefined ? a === b : rb.text.trim() === vb.text.trim())
    if (!same) extra.bodyPatterns = [{ equalToJson: vb.text, ignoreExtraElements: true }]
  } else if (vb?.kind === 'form') {
    const ref = rb?.kind === 'form' ? formFields(rb.text) : new Map<string, string>()
    const diff = [...formFields(vb.text)].filter(([k, v]) => ref.get(k) !== v)
    if (diff.length) extra.formParameters = Object.fromEntries(diff.map(([k, v]) => [k, { equalTo: v }]))
  }
  const refQuery = new Map(reference.query)
  const query = [...new Map(variant.query)].filter(([k, v]) => refQuery.get(k) !== v)
  if (query.length) extra.queryParameters = Object.fromEntries(query.map(([k, v]) => [k, { equalTo: v }]))
  const vars = Object.entries(variant.pathVars).filter(([k, v]) => templateVars.has(k) && v !== '' && reference.pathVars[k] !== v)
  if (vars.length) extra.pathParameters = Object.fromEntries(vars.map(([k, v]) => [k, { equalTo: v }]))
  return extra
}

function responseFor(contentType: ContentType, example: PmExample): Record<string, unknown> {
  const response: Record<string, unknown> = { status: example.status }
  const body = example.body
  if (contentType === 'json' && body.trim() !== '' && !isJson(body)) {
    // Not the JSON the endpoint promises: keep the example's own type and text (the mock opens in Advanced mode).
    response.headers = { 'Content-Type': example.contentType || 'text/plain; charset=utf-8' }
    response.body = body
    return response
  }
  response.headers = { 'Content-Type': MIME[contentType] }
  if (body.trim() === '') return response
  if (contentType === 'json') response.jsonBody = JSON.parse(body)
  else response.body = body
  return response
}

/** Plans the import: one row per usable request, and the bundle `POST /api/import` takes. */
export function planPostman(c: PostmanCollection, opts: PlanOptions): Plan {
  const integration = opts.existing ? opts.existing.integration : opts.integration
  const existingKeys = new Set(opts.existing?.endpointKeys ?? [])
  const requests = usableRequests(c)

  // Keys from request names, unique within the collection.
  const proposed: string[] = []
  const inCollection = new Set<string>()
  for (const r of requests) {
    const key = uniqueKey(slugify(r.name || `${r.request.method} ${r.request.path}`, 'endpoint'), inCollection)
    inCollection.add(key)
    proposed.push(key)
  }
  // "Create new" renames a conflicting key to one taken neither in the integration nor in this collection.
  const taken = new Set([...existingKeys, ...inCollection])

  const root = integration.prefix === '/' ? '' : integration.prefix
  const bundle: Bundle = { integrations: [], catalog: [], mocks: [], oidcIdentities: [] }
  if (!opts.existing) {
    const { key, name, prefix, description } = opts.integration
    bundle.integrations.push({ key, name, prefix, ...(description ? { description } : {}) })
  }

  const rows: PlanRow[] = requests.map((r, i) => {
    const choice = opts.choices?.[r.id] ?? {}
    const conflict = existingKeys.has(proposed[i])
    const action: RowAction = choice.action ?? 'create'
    let key = proposed[i]
    if (conflict && action === 'create') {
      key = uniqueKey(proposed[i], taken)
      taken.add(key)
    }
    const path = pathUnder(integration.prefix, r.request.path)
    const name = r.name || `${r.request.method} ${r.request.path}`
    const defaultId = r.examples.some((e) => e.id === choice.defaultExample) ? choice.defaultExample : defaultExampleOf(r)
    const row: PlanRow = {
      id: r.id,
      request: r,
      method: r.request.method,
      path,
      url: root + path,
      name,
      proposedKey: proposed[i],
      key,
      conflict,
      // Overwrite only means something for a key that exists.
      action: conflict || action === 'skip' ? action : 'create',
      defaultExample: defaultId,
      mocks: 0,
      skipped: [],
    }
    if (row.action === 'skip') return row

    const template = /\{[^{}/]+\}/.test(path)
    const templateVars = new Set([...path.matchAll(/\{([^{}/]+)\}/g)].map((m) => m[1]))
    const def = r.examples.find((e) => e.id === defaultId)
    const contentType = contentTypeOf(r, def)
    const exampleResponses: Record<string, string> = {}
    for (const e of r.examples) {
      const k = String(e.status)
      if (k in exampleResponses) continue
      if (contentType === 'json' && e.body.trim() !== '' && !isJson(e.body)) continue
      exampleResponses[k] = contentType === 'json' && e.body.trim() !== '' ? pretty(e.body) : e.body
    }
    const reqBody = (def?.request ?? r.request).body ?? r.request.body
    const exampleRequest =
      reqBody && (contentType !== 'json' || isJson(reqBody.text))
        ? contentType === 'json'
          ? pretty(reqBody.text)
          : reqBody.text
        : undefined
    bundle.catalog.push({
      integration: integration.key,
      key,
      name,
      method: r.request.method,
      path,
      pathType: template ? 'template' : 'exact',
      contentType,
      ...(exampleRequest !== undefined ? { exampleRequest } : {}),
      exampleResponses,
      allowedStatuses: [...new Set(r.examples.map((e) => e.status))].sort((a, b) => a - b),
      ...(r.description ? { description: r.description } : {}),
    })

    const base = { method: r.request.method, [template ? 'urlPathTemplate' : 'urlPath']: root + path }
    const meta = { wiremockUi: { integration: integration.key, endpoint: key } }
    // An id per (integration, endpoint, example): importing again into the same endpoint (Overwrite) updates these
    // mocks; "Create new" (another endpoint key) or another integration gets mocks of its own.
    const stub = (example: PmExample, priority: number, extra: Record<string, unknown>) =>
      ({
        id: mockId(integration.key, key, example),
        name: `${name} — ${example.name}`,
        priority,
        request: { ...base, ...extra },
        response: responseFor(contentType, example),
        metadata: meta,
      }) as unknown as StubMapping

    if (def) {
      bundle.mocks.push(stub(def, 10, {}))
      row.mocks++
      const reference = def.request ?? r.request
      const seen = new Set<string>()
      for (const e of r.examples) {
        if (e === def) continue
        if (!e.request) {
          row.skipped.push({ name: e.name, reason: 'postman.skipNoRequest' })
          continue
        }
        const extra = distinguishing(e.request, reference, templateVars)
        if (Object.keys(extra).length === 0) {
          row.skipped.push({ name: e.name, reason: 'postman.skipSameRequest' })
          continue
        }
        const sig = canonical(extra) ?? `${seen.size}:${e.id}`
        if (seen.has(sig)) {
          row.skipped.push({ name: e.name, reason: 'postman.skipDuplicate' })
          continue
        }
        seen.add(sig)
        bundle.mocks.push(stub(e, 5, extra))
        row.mocks++
      }
    }
    return row
  })

  const imported = rows.filter((r) => r.action !== 'skip')
  return {
    integration,
    addsToExisting: Boolean(opts.existing),
    rows,
    bundle,
    endpoints: imported.length,
    mocks: bundle.mocks.length,
  }
}

/** Requests left out of the plan (a method the catalog has no place for). */
export const unusableRequests = (c: PostmanCollection) => c.requests.filter((r) => !(METHODS as readonly string[]).includes(r.request.method))

/* ---------- Mock ids ---------- */

/** SHA-1 of a UTF-8 string (pure, synchronous: the plan is built while rendering). */
export function sha1(text: string): Uint8Array {
  const bytes = new TextEncoder().encode(text)
  const length = bytes.length
  const words = new Uint32Array((((length + 8) >> 6) + 1) * 16)
  for (let i = 0; i < length; i++) words[i >> 2] |= bytes[i] << (24 - (i % 4) * 8)
  words[length >> 2] |= 0x80 << (24 - (length % 4) * 8)
  words[words.length - 1] = length * 8
  words[words.length - 2] = Math.floor((length * 8) / 0x100000000)
  let [h0, h1, h2, h3, h4] = [0x67452301, 0xefcdab89, 0x98badcfe, 0x10325476, 0xc3d2e1f0]
  const w = new Uint32Array(80)
  const rotl = (x: number, n: number) => (x << n) | (x >>> (32 - n))
  for (let block = 0; block < words.length; block += 16) {
    for (let t = 0; t < 16; t++) w[t] = words[block + t]
    for (let t = 16; t < 80; t++) w[t] = rotl(w[t - 3] ^ w[t - 8] ^ w[t - 14] ^ w[t - 16], 1)
    let [a, b, c, d, e] = [h0, h1, h2, h3, h4]
    for (let t = 0; t < 80; t++) {
      const f = t < 20 ? (b & c) | (~b & d) : t < 40 ? b ^ c ^ d : t < 60 ? (b & c) | (b & d) | (c & d) : b ^ c ^ d
      const k = t < 20 ? 0x5a827999 : t < 40 ? 0x6ed9eba1 : t < 60 ? 0x8f1bbcdc : 0xca62c1d6
      const temp = (rotl(a, 5) + f + e + k + w[t]) >>> 0
      e = d
      d = c
      c = rotl(b, 30) >>> 0
      b = a
      a = temp
    }
    h0 = (h0 + a) >>> 0
    h1 = (h1 + b) >>> 0
    h2 = (h2 + c) >>> 0
    h3 = (h3 + d) >>> 0
    h4 = (h4 + e) >>> 0
  }
  const out = new Uint8Array(20)
  ;[h0, h1, h2, h3, h4].forEach((h, i) => {
    out[i * 4] = h >>> 24
    out[i * 4 + 1] = (h >>> 16) & 0xff
    out[i * 4 + 2] = (h >>> 8) & 0xff
    out[i * 4 + 3] = h & 0xff
  })
  return out
}

/** A version-5-style UUID (as WireMock and the store expect) from the SHA-1 of `name`. */
export function uuidFromName(name: string): string {
  const hash = sha1(name)
  hash[6] = (hash[6] & 0x0f) | 0x50
  hash[8] = (hash[8] & 0x3f) | 0x80
  const hex = [...hash.slice(0, 16)].map((b) => b.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`
}

/** The mock id for one example of one endpoint: stable across imports, different per endpoint key and integration. */
export function mockId(integration: string, endpoint: string, example: Pick<PmExample, 'id' | 'name'>): string {
  // The example's index within its request (`r3e1` → 1) keeps two examples with the same name apart.
  const index = example.id.replace(/^r\d+e/, '')
  return uuidFromName(`wiremock-ui/postman/${integration}/${endpoint}/${index}/${example.name}`)
}

/**
 * A collection as an import bundle of plain mocks: each saved example a mock (the request's default example answers
 * every call to it; the others only the calls their request differs in), tagged with the collection's name and the
 * request's top folder. Integrations are retired: the plan's catalog only names the tags (src/server/catalog/migrate.ts).
 */
export function postmanBundle(c: PostmanCollection): { bundle: Bundle; requests: number; skipped: number } {
  const key = slugify(c.name, 'postman')
  const plan = planPostman(c, { integration: { key, name: c.name, prefix: '/' } })
  const folderTag = new Map(plan.rows.map((r) => [r.key, r.request.folder[0] ? slugify(r.request.folder[0], '') : '']))
  const mocks = migrateLinkedStubs(plan.bundle.mocks, legacyEndpointsOf(plan.bundle.catalog)).map((stub, i) => {
    const folder = folderTag.get((plan.bundle.mocks[i]!.metadata?.wiremockUi as { endpoint?: string } | undefined)?.endpoint ?? '')
    if (!folder) return stub
    const ui = (stub.metadata?.wiremockUi ?? {}) as Record<string, unknown>
    const tags = Array.isArray(ui.tags) ? (ui.tags as string[]) : []
    return { ...stub, metadata: { ...stub.metadata, wiremockUi: { ...ui, tags: tags.includes(folder) ? tags : [...tags, folder] } } } as StubMapping
  })
  return {
    bundle: { integrations: [], catalog: [], mocks, oidcIdentities: [] },
    requests: plan.rows.length,
    skipped: plan.rows.reduce((n, r) => n + r.skipped.length, 0) + (c.requests.length - plan.rows.length),
  }
}
