import { expect, test } from 'vitest'
import { looksLikeRegex, regexProblem, resolvePathFilter, wildcardToRegex } from '../../../src/server/recording/path-pattern'
import { snapshotSchema, startSchema } from '../../../src/server/recording/service'
import { validateTarget } from '../../../src/server/recording/target'
import { trimTrailingSlashes } from '../../../src/server/url'

// Recording inputs come from users: every check on them must stay linear (no backtracking blow-up).
const fast = (fn: () => unknown) => {
  const t = performance.now()
  fn()
  return performance.now() - t
}
const N = 100_000

test('path checks finish in well under 50 ms on 100k-character inputs', () => {
  const inputs = ['?'.repeat(N), '?'.repeat(N) + '=', 'a'.repeat(N), '{' + '1'.repeat(N), '/'.repeat(N) + 'x', '*'.repeat(N), '.*'.repeat(N / 2)]
  for (const input of inputs) {
    for (const fn of [regexProblem, looksLikeRegex, wildcardToRegex, (s: string) => resolvePathFilter(s, 'auto')]) {
      expect(fast(() => fn(input)), `${fn.name} on ${input.slice(0, 3)}…`).toBeLessThan(50)
    }
  }
})

test('target normalising and slash trimming are linear', () => {
  const refused = { wiremock: ['http://wiremock:8080'], app: ['http://ui:3000'] }
  expect(fast(() => validateTarget('http://up.example/' + 'a/'.repeat(N / 2) + 'x', refused))).toBeLessThan(50)
  expect(fast(() => validateTarget('http://up.example/' + '/'.repeat(N), refused))).toBeLessThan(50)
  expect(fast(() => trimTrailingSlashes('/'.repeat(N) + 'x'))).toBeLessThan(50)
  expect(trimTrailingSlashes('https://x/api///')).toBe('https://x/api')
  expect(trimTrailingSlashes('///')).toBe('')
})

test('the query check still finds a ?…= query and only that', () => {
  expect(regexProblem('/api/x?limit=3')?.kind).toBe('query')
  expect(regexProblem('/api/x?')).toBeNull()
  expect(regexProblem('/a?b')).toBeNull()
})

test('targetUrl and urlPathPattern have length caps', () => {
  expect(startSchema.safeParse({ targetUrl: 'http://x/' + 'a'.repeat(2048) }).error?.issues[0].message).toBe('targetUrl must be at most 2048 characters')
  expect(snapshotSchema.safeParse({ urlPathPattern: '/' + 'a'.repeat(1024) }).error?.issues[0].message).toBe('urlPathPattern must be at most 1024 characters')
  expect(snapshotSchema.safeParse({ urlPathPattern: '/' + 'a'.repeat(1023) }).success).toBe(true)
})
