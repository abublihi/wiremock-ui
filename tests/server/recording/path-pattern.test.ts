import { expect, test } from 'vitest'
import { looksLikeRegex, regexProblem, regexProblemMessage, resolvePathFilter, wildcardToRegex } from '../../../src/server/recording/path-pattern'

test('a wildcard becomes an anchored regex: * is anything, everything else means itself', () => {
  expect(wildcardToRegex('/api/*')).toEqual({ regex: '^/api/.*$', addedSlash: false, example: '/api/…' })
  expect(wildcardToRegex('/api/Products*').regex).toBe('^/api/Products.*$')
  expect(wildcardToRegex('/v1.0/items(1)+').regex).toBe('^/v1\\.0/items\\(1\\)\\+$')
  const regex = new RegExp(wildcardToRegex('/api/*').regex)
  expect(regex.test('/api/Products')).toBe(true)
  expect(regex.test('/apix')).toBe(false)
  expect(regex.test('/other/api/x')).toBe(false)
})

test('a typed query string is dropped and a missing leading slash added, and both are reported', () => {
  expect(wildcardToRegex('/api/Products?limit=3')).toEqual({ regex: '^/api/Products$', droppedQuery: '?limit=3', addedSlash: false, example: '/api/Products' })
  expect(wildcardToRegex('api/*')).toEqual({ regex: '^/api/.*$', addedSlash: true, example: '/api/…' })
  expect(wildcardToRegex('*/Products').regex).toBe('^.*/Products$')
})

test('a regex that can never match a path is caught, with a suggestion', () => {
  expect(regexProblem('/api/.*')).toBeNull()
  expect(regexProblem('^/api/[0-9]+$')).toBeNull()
  expect(regexProblem('.*/Products')).toBeNull()
  expect(regexProblem('(/a|/b)/.*')).toBeNull()
  expect(regexProblem('api/Products?limit=3')).toEqual({ kind: 'query', suggestion: '/api/Products.*' })
  expect(regexProblem('/api/Products?limit=3')).toEqual({ kind: 'query', suggestion: '/api/Products.*' })
  expect(regexProblem('api/.*')).toEqual({ kind: 'start', suggestion: '/api/.*' })
  expect(regexProblemMessage(regexProblem('api/Products?limit=3')!, 'api/Products?limit=3')).toBe(
    'urlPathPattern matches the path only, without the query string. To record /api/Products?limit=3 use /api/Products.*',
  )
})

test('auto reads regex-only syntax as a regex, anything else as a wildcard; a mode overrides it', () => {
  const read = (text: string, mode?: 'auto' | 'wildcard' | 'regex') => {
    const r = resolvePathFilter(text, mode)
    return [r.kind, r.regex]
  }
  expect(read('/api/*')).toEqual(['wildcard', '^/api/.*$'])
  expect(read('/api/.*')).toEqual(['regex', '/api/.*'])
  expect(read('/api/Products*')).toEqual(['wildcard', '^/api/Products.*$'])
  expect(read('/api/Products?limit=3')).toEqual(['wildcard', '^/api/Products$'])
  expect(read('^/api/(a|b)$')).toEqual(['regex', '^/api/(a|b)$'])
  for (const [text, path] of [['/api/*', '/api/Products'], ['/api/.*', '/api/Products'], ['/api/Products*', '/api/Products'], ['/api/Products?limit=3', '/api/Products'], ['^/api/(a|b)$', '/api/b']]) {
    expect(new RegExp(`^(?:${resolvePathFilter(text).regex})$`).test(path), text).toBe(true)
  }
  expect(looksLikeRegex('/items/[0-9]{3}')).toBe(true)
  expect(looksLikeRegex('/api/v1.0/*')).toBe(false)
  expect(read('/api/.*', 'wildcard')).toEqual(['wildcard', '^/api/\\..*$'])
  expect(read('/api/x', 'regex')).toEqual(['regex', '/api/x'])
  expect(resolvePathFilter('/api/Products?limit=3')).toMatchObject({ droppedQuery: '?limit=3', example: '/api/Products' })
  expect(resolvePathFilter('/api/*')).toMatchObject({ example: '/api/…' })
})
