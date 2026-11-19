import { expect, test } from 'vitest'
import { longestPrefixMatch, matchesPrefix } from '../../../src/server/catalog/prefix'

test('path-boundary prefix rule', () => {
  expect(matchesPrefix('/pay', '/pay')).toBe(true)
  expect(matchesPrefix('/pay/x', '/pay')).toBe(true)
  expect(matchesPrefix('/pay?a=1', '/pay')).toBe(true)
  expect(matchesPrefix('/payments', '/pay')).toBe(false)
  expect(matchesPrefix('/anything', '/')).toBe(true)
})

test('longest prefix wins', () => {
  const p = [{ key: 'a', prefix: '/pay' }, { key: 'b', prefix: '/pay/v2' }]
  expect(longestPrefixMatch(['/pay/v2/x'], p)).toBe('b')
  expect(longestPrefixMatch(['/pay/v1/x'], p)).toBe('a')
  expect(longestPrefixMatch(['/other'], p)).toBeUndefined()
})
