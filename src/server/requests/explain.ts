import { JSONPath } from 'jsonpath-plus'
import type { LoggedRequest, StubMapping } from '../wiremock/types'

/** `matched: null` means the field could not be checked (unsupported or malformed matcher). */
export type FieldDiff = { field: string; expected: string; actual: string | null; matched: boolean | null }

type Obj = Record<string, unknown>
type Verdict = { expected: string; matched: boolean | null }

const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v)
const json = (v: unknown) => {
  try {
    return JSON.stringify(v) ?? String(v)
  } catch {
    return String(v)
  }
}
const show = (v: unknown) => (typeof v === 'string' ? v : json(v))

/**
 * WireMock `matches` is a full-string regex. Invalid expressions yield null instead of throwing.
 * The stub's regex runs in Node's engine, not WireMock's Java one: dialects differ in corners (possessive
 * quantifiers, some classes), and a pathological pattern can hold this request's thread for a while. Accepted:
 * stubs come from signed-in users (spec A8, everyone is trusted) or WireMock admins, and values are capped at
 * MAX_REGEX_INPUT characters.
 */
const MAX_REGEX_INPUT = 10_000
const TOO_LONG = ' (value too long to check)'

function fullMatch(re: unknown, value: string): boolean | null {
  if (typeof re !== 'string') return null
  try {
    return new RegExp(`^(?:${re})$`).test(value)
  } catch {
    return null
  }
}

const OPERATORS = ['equalTo', 'contains', 'doesNotContain', 'matches', 'doesNotMatch', 'absent'] as const

/** Evaluates one WireMock string matcher against a single value (`null` = missing). */
function evalString(pattern: unknown, actual: string | null): Verdict {
  const unknown: Verdict = { expected: json(pattern), matched: null }
  if (!isObj(pattern)) return unknown
  const op = Object.keys(pattern).find((k) => k !== 'caseInsensitive')
  if (!op || !(OPERATORS as readonly string[]).includes(op)) return unknown
  const arg = pattern[op]
  const ci = pattern.caseInsensitive === true
  if (op === 'absent') return { expected: 'absent', matched: arg === true ? actual === null : actual !== null }
  if (typeof arg !== 'string') return unknown
  const expected = `${op} ${arg}${ci && (op === 'equalTo' || op === 'contains') ? ' (ignore case)' : ''}`
  if (actual === null) return { expected, matched: false }
  if ((op === 'matches' || op === 'doesNotMatch') && actual.length > MAX_REGEX_INPUT) {
    return { expected: expected + TOO_LONG, matched: null }
  }
  const a = ci ? actual.toLowerCase() : actual
  const e = ci ? arg.toLowerCase() : arg
  switch (op) {
    case 'equalTo':
      return { expected, matched: a === e }
    case 'contains':
      return { expected, matched: a.includes(e) }
    case 'doesNotContain':
      return { expected, matched: !a.includes(e) }
    case 'matches':
      return { expected, matched: fullMatch(arg, actual) }
    default: {
      const m = fullMatch(arg, actual)
      return { expected, matched: m === null ? null : !m }
    }
  }
}

/** Any value may satisfy the matcher (WireMock's default single-value semantics for multi-valued fields). */
function evalMulti(pattern: unknown, values: string[]): { verdict: Verdict; actual: string | null } {
  const actual = values.length ? values.join(', ') : null
  if (values.length <= 1) return { verdict: evalString(pattern, values[0] ?? null), actual }
  const per = values.map((v) => evalString(pattern, v))
  const expected = per[0].expected
  if (per.some((p) => p.matched === true)) return { verdict: { expected, matched: true }, actual }
  return { verdict: { expected, matched: per.some((p) => p.matched === null) ? null : false }, actual }
}

const row = (field: string, v: Verdict, actual: string | null): FieldDiff => ({ field, expected: v.expected, actual, matched: v.matched })

function toStrings(v: unknown): string[] {
  if (typeof v === 'string') return [v]
  if (typeof v === 'number' || typeof v === 'boolean') return [String(v)]
  if (Array.isArray(v)) return v.flatMap(toStrings)
  if (isObj(v) && 'values' in v) return toStrings(v.values)
  return []
}

function lookupCI(map: unknown, name: string): string[] {
  if (!isObj(map)) return []
  const key = Object.keys(map).find((k) => k.toLowerCase() === name.toLowerCase())
  return key === undefined ? [] : toStrings(map[key])
}

function splitUrl(url: string): { path: string; query: string } {
  const i = url.indexOf('?')
  return i < 0 ? { path: url, query: '' } : { path: url.slice(0, i), query: url.slice(i + 1) }
}

function parseForm(text: string): Map<string, string[]> {
  const out = new Map<string, string[]>()
  for (const [k, v] of new URLSearchParams(text)) out.set(k, [...(out.get(k) ?? []), v])
  return out
}

function bodyText(request: LoggedRequest): string | null {
  if (typeof request.body === 'string') return request.body
  if (typeof request.bodyAsBase64 === 'string') {
    try {
      return Buffer.from(request.bodyAsBase64, 'base64').toString('utf8')
    } catch {
      return null
    }
  }
  return null
}

/** `{id}` placeholders become capture groups. Returns the path's values by name, or null when the path does not fit. */
function matchTemplate(template: string, path: string): { names: string[]; values: Record<string, string> | null } {
  const names: string[] = []
  const source = template
    .split(/(\{[^{}/]+\})/)
    .map((part) => {
      const m = /^\{([^{}/]+)\}$/.exec(part)
      if (!m) return part.replace(/[\\^$.*+?()[\]{}|]/g, '\\$&')
      names.push(m[1])
      return '([^/]+)'
    })
    .join('')
  const hit = new RegExp(`^${source}$`).exec(path)
  if (!hit) return { names, values: null }
  const values: Record<string, string> = {}
  names.forEach((n, i) => {
    values[n] = hit[i + 1]
  })
  return { names, values }
}

function jsonEq(exp: unknown, act: unknown, ignoreOrder: boolean, ignoreExtra: boolean): boolean {
  if (Array.isArray(exp)) {
    if (!Array.isArray(act)) return false
    if (!ignoreExtra && exp.length !== act.length) return false
    if (exp.length > act.length) return false
    if (!ignoreOrder) {
      let from = 0
      return exp.every((e) => {
        for (let i = from; i < act.length; i++) {
          if (jsonEq(e, act[i], ignoreOrder, ignoreExtra)) {
            from = i + 1
            return true
          }
          if (!ignoreExtra) return false
        }
        return false
      })
    }
    // Augmenting-path bipartite matching: greedy assignment can reject valid pairings.
    const owner = new Array<number>(act.length).fill(-1)
    const assign = (e: number, seen: Set<number>): boolean => {
      for (let a = 0; a < act.length; a++) {
        if (seen.has(a) || !jsonEq(exp[e], act[a], ignoreOrder, ignoreExtra)) continue
        seen.add(a)
        if (owner[a] < 0 || assign(owner[a], seen)) {
          owner[a] = e
          return true
        }
      }
      return false
    }
    return exp.every((_, e) => assign(e, new Set()))
  }
  if (isObj(exp)) {
    if (!isObj(act)) return false
    const keys = Object.keys(exp)
    if (!ignoreExtra && keys.length !== Object.keys(act).length) return false
    return keys.every((k) => Object.hasOwn(act, k) && jsonEq(exp[k], act[k], ignoreOrder, ignoreExtra))
  }
  return exp === act
}

const stringify = (v: unknown) => (typeof v === 'string' ? v : json(v))

function explainJsonPath(pattern: unknown, body: string | null): FieldDiff {
  const field = 'body'
  const expr = typeof pattern === 'string' ? pattern : isObj(pattern) ? pattern.expression : undefined
  if (typeof expr !== 'string') return { field, expected: `matchesJsonPath ${json(pattern)}`, actual: body, matched: null }
  const sub = isObj(pattern) ? Object.fromEntries(Object.entries(pattern).filter(([k]) => k !== 'expression')) : {}
  const hasSub = Object.keys(sub).length > 0
  const subExpected = hasSub ? evalString(sub, null).expected : ''
  const expected = `matchesJsonPath ${expr}${hasSub ? ` ${subExpected}` : ''}`
  if (body === null) return { field, expected, actual: null, matched: false }
  let doc: unknown
  try {
    doc = JSON.parse(body)
  } catch {
    return { field, expected, actual: body, matched: false }
  }
  let found: unknown[]
  try {
    const out = JSONPath({ path: expr, json: doc as object, wrap: true, eval: 'safe' }) as unknown
    found = Array.isArray(out) ? out : []
  } catch {
    return { field, expected, actual: null, matched: null }
  }
  const values = found.map(stringify)
  const actual = values.length ? values.join(', ') : null
  if (!hasSub) return { field, expected, actual, matched: values.length > 0 }
  const per = values.map((v) => evalString(sub, v))
  if (!per.length) return { field, expected, actual, matched: evalString(sub, null).matched === true ? true : false }
  const matched = per.some((p) => p.matched === true) ? true : per.some((p) => p.matched === null) ? null : false
  return { field, expected, actual, matched }
}

function explainEqualToJson(pattern: Obj, body: string | null): FieldDiff {
  const field = 'body'
  const raw = pattern.equalToJson
  const flags = ['ignoreArrayOrder', 'ignoreExtraElements'].filter((f) => pattern[f] === true)
  const text = typeof raw === 'string' ? raw : json(raw)
  const expected = `equalToJson ${text}${flags.length ? ` (${flags.join(', ')})` : ''}`
  if (text.includes('${json-unit.')) return { field, expected, actual: body, matched: null }
  let exp: unknown
  try {
    exp = typeof raw === 'string' ? JSON.parse(raw) : raw
  } catch {
    return { field, expected, actual: body, matched: null }
  }
  if (body === null) return { field, expected, actual: null, matched: false }
  try {
    const act = JSON.parse(body)
    return { field, expected, actual: body, matched: jsonEq(exp, act, flags.includes('ignoreArrayOrder'), flags.includes('ignoreExtraElements')) }
  } catch {
    return { field, expected, actual: body, matched: false }
  }
}

function explainBody(pattern: unknown, body: string | null): FieldDiff {
  if (isObj(pattern)) {
    if ('equalToJson' in pattern) return explainEqualToJson(pattern, body)
    if ('matchesJsonPath' in pattern) return explainJsonPath(pattern.matchesJsonPath, body)
    if ('matchesXPath' in pattern) {
      const x = pattern.matchesXPath
      return { field: 'body', expected: `matchesXPath ${isObj(x) ? json(x) : show(x)}`, actual: null, matched: null }
    }
  }
  return row('body', evalString(pattern, body), body)
}

function explainBasicAuth(creds: unknown, request: LoggedRequest): FieldDiff {
  const header = lookupCI(request.headers, 'Authorization')[0]
  let actual: { user: string; pass: string } | null = null
  if (header && /^basic\s+/i.test(header)) {
    const decoded = Buffer.from(header.replace(/^basic\s+/i, ''), 'base64').toString('utf8')
    const i = decoded.indexOf(':')
    if (i >= 0) actual = { user: decoded.slice(0, i), pass: decoded.slice(i + 1) }
  }
  const actualText = actual ? `${actual.user}:***` : null
  if (!isObj(creds) || typeof creds.username !== 'string' || typeof creds.password !== 'string') {
    return { field: 'basicAuth', expected: `basicAuth ${json(creds)}`, actual: actualText, matched: null }
  }
  // The password is never echoed; only the comparison result reveals it.
  return {
    field: 'basicAuth',
    expected: `basicAuth ${creds.username}:***`,
    actual: actualText,
    matched: actual !== null && actual.user === creds.username && actual.pass === creds.password,
  }
}

function queryValues(request: LoggedRequest, name: string): string[] {
  if (isObj(request.queryParams)) {
    const v = request.queryParams[name]
    if (v !== undefined) return toStrings(v)
    return []
  }
  return new URLSearchParams(splitUrl(request.url).query).getAll(name)
}

function cookieValues(request: LoggedRequest, name: string): string[] {
  if (isObj(request.cookies)) return toStrings(request.cookies[name])
  const out: string[] = []
  for (const header of lookupCI(request.headers, 'Cookie')) {
    for (const part of header.split(';')) {
      const i = part.indexOf('=')
      if (i > 0 && part.slice(0, i).trim() === name) out.push(part.slice(i + 1).trim())
    }
  }
  return out
}

function explainUrl(req: Obj, request: LoggedRequest): FieldDiff[] {
  const { path } = splitUrl(request.url)
  const rows: FieldDiff[] = []
  const eq = (field: string, expected: unknown, actual: string) => {
    if (typeof expected !== 'string') return rows.push({ field, expected: `${field} ${json(expected)}`, actual, matched: null })
    rows.push({ field, expected: `equalTo ${expected}`, actual, matched: expected === actual })
  }
  const re = (field: string, expected: unknown, actual: string) => {
    if (typeof expected !== 'string') return rows.push({ field, expected: `${field} ${json(expected)}`, actual, matched: null })
    if (actual.length > MAX_REGEX_INPUT) return rows.push({ field, expected: `matches ${expected}${TOO_LONG}`, actual, matched: null })
    rows.push({ field, expected: `matches ${expected}`, actual, matched: fullMatch(expected, actual) })
  }
  if ('url' in req) eq('url', req.url, request.url)
  if ('urlPath' in req) eq('urlPath', req.urlPath, path)
  if ('urlPattern' in req) re('urlPattern', req.urlPattern, request.url)
  if ('urlPathPattern' in req) re('urlPathPattern', req.urlPathPattern, path)
  if ('urlPathTemplate' in req) {
    const t = req.urlPathTemplate
    if (typeof t !== 'string') rows.push({ field: 'urlPathTemplate', expected: `template ${json(t)}`, actual: path, matched: null })
    else rows.push({ field: 'urlPathTemplate', expected: `template ${t}`, actual: path, matched: matchTemplate(t, path).values !== null })
  }
  return rows
}

/**
 * Explains, field by field, how a logged request compares with a stub. Pure and total: anything it does not
 * understand becomes a `matched: null` row instead of an exception.
 */
export function explainMismatch(stub: StubMapping, request: LoggedRequest): FieldDiff[] {
  const req: Obj = isObj(stub?.request) ? stub.request : {}
  const rows: FieldDiff[] = []
  try {
    if (typeof req.method === 'string') {
      const any = req.method.toUpperCase() === 'ANY'
      rows.push({
        field: 'method',
        expected: `equalTo ${req.method}`,
        actual: request.method ?? null,
        matched: any || req.method.toUpperCase() === String(request.method ?? '').toUpperCase(),
      })
    }
    rows.push(...explainUrl(req, request))

    if (isObj(req.pathParameters)) {
      const t = typeof req.urlPathTemplate === 'string' ? matchTemplate(req.urlPathTemplate, splitUrl(request.url).path) : null
      for (const [name, pattern] of Object.entries(req.pathParameters)) {
        const value = t?.values?.[name] ?? null
        rows.push(row(`pathParam.${name}`, evalString(pattern, value), value))
      }
    }
    if (isObj(req.queryParameters)) {
      for (const [name, pattern] of Object.entries(req.queryParameters)) {
        const { verdict, actual } = evalMulti(pattern, queryValues(request, name))
        rows.push(row(`query.${name}`, verdict, actual))
      }
    }
    if (isObj(req.headers)) {
      for (const [name, pattern] of Object.entries(req.headers)) {
        const { verdict, actual } = evalMulti(pattern, lookupCI(request.headers, name))
        rows.push(row(`header.${name}`, verdict, actual))
      }
    }
    if (isObj(req.cookies)) {
      for (const [name, pattern] of Object.entries(req.cookies)) {
        const { verdict, actual } = evalMulti(pattern, cookieValues(request, name))
        rows.push(row(`cookie.${name}`, verdict, actual))
      }
    }
    if (req.basicAuthCredentials !== undefined) rows.push(explainBasicAuth(req.basicAuthCredentials, request))
    if (isObj(req.formParameters)) {
      const type = lookupCI(request.headers, 'Content-Type')[0] ?? ''
      const text = bodyText(request)
      const form = /x-www-form-urlencoded/i.test(type) && text !== null ? parseForm(text) : new Map<string, string[]>()
      for (const [name, pattern] of Object.entries(req.formParameters)) {
        const { verdict, actual } = evalMulti(pattern, form.get(name) ?? [])
        rows.push(row(`form.${name}`, verdict, actual))
      }
    }
    if (Array.isArray(req.bodyPatterns)) {
      const body = bodyText(request)
      for (const pattern of req.bodyPatterns) rows.push(explainBody(pattern, body))
    }
  } catch {
    // Never let an odd stub or request break the explanation; keep what was computed so far.
  }
  return rows
}
