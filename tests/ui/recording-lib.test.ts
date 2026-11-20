import { describe, expect, it } from 'vitest'
import type { Endpoint, Integration } from '@/server/catalog/types'
import type { ReviewItem } from '@/server/recording/types'
import { acceptPayload, formatBytes, NEW_ENDPOINT, newEndpointFor, suggestLink, type RowChoice } from '@/ui/lib/recording'

const integration = (key: string, prefix: string): Integration => ({ key, name: key, prefix, updatedAt: '', updatedBy: '' })
const endpoint = (over: Partial<Endpoint>): Endpoint => ({
  integration: 'shop', key: 'get-item', name: 'Get item', method: 'GET', path: '/items/1', pathType: 'exact', contentType: 'json',
  exampleResponses: {}, allowedStatuses: [], updatedAt: '', updatedBy: '', ...over,
})
const item = (method: string, url: string, id = url): ReviewItem => ({
  id, method, url, status: 200, bodySize: 1, stub: { name: `${method} ${url}`, request: { method, urlPath: url.split('?')[0] }, response: { status: 200 } },
})

describe('suggestLink', () => {
  const integrations = [integration('shop', '/shop'), integration('shop-admin', '/shop/admin'), integration('all', '/')]
  it('picks the longest matching prefix and an endpoint with the same method and path', () => {
    const endpoints = { shop: [endpoint({}), endpoint({ key: 'post-item', method: 'POST' })] }
    expect(suggestLink(item('GET', '/shop/items/1'), integrations.slice(0, 2), endpoints)).toEqual({ integration: 'shop', endpoint: 'get-item' })
    expect(suggestLink(item('POST', '/shop/items/1'), integrations.slice(0, 2), endpoints)).toEqual({ integration: 'shop', endpoint: 'post-item' })
    expect(suggestLink(item('GET', '/shop/admin/users'), integrations.slice(0, 2), endpoints)).toEqual({ integration: 'shop-admin', endpoint: NEW_ENDPOINT })
  })
  it('offers a new endpoint when the prefix matches but no endpoint does; none without a prefix match', () => {
    expect(suggestLink(item('DELETE', '/shop/items/1?x=1'), integrations.slice(0, 1), { shop: [endpoint({})] })).toEqual({ integration: 'shop', endpoint: NEW_ENDPOINT })
    expect(suggestLink(item('GET', '/other'), integrations.slice(0, 2), {})).toEqual({ integration: '', endpoint: '' })
    // A catch-all "/" integration is not a suggestion.
    expect(suggestLink(item('GET', '/other'), integrations, {})).toEqual({ integration: '', endpoint: '' })
  })
})

describe('newEndpointFor', () => {
  it('derives a key and a name from the method and the path under the prefix', () => {
    expect(newEndpointFor(item('GET', '/shop/items/1?q=1'), integration('shop', '/shop'))).toEqual({ key: 'get-items-1', name: 'GET /items/1' })
    expect(newEndpointFor(item('POST', '/Orders/{id}/Pay'), integration('all', '/'))).toEqual({ key: 'post-orders-id-pay', name: 'POST /Orders/{id}/Pay' })
    expect(newEndpointFor(item('GET', '/' + 'a'.repeat(100)), integration('all', '/')).key).toHaveLength(63)
  })
})

describe('acceptPayload', () => {
  const integrations = [integration('shop', '/shop')]
  const rows: (RowChoice & { item: ReviewItem })[] = [
    { item: item('GET', '/shop/items/1', 'a'), name: '', integration: 'shop', endpoint: NEW_ENDPOINT },
    { item: item('GET', '/shop/items/1?x=2', 'b'), name: 'Second', integration: 'shop', endpoint: NEW_ENDPOINT },
    { item: item('GET', '/x', 'c'), name: '  ', integration: '', endpoint: '' },
    { item: item('GET', '/shop/y', 'd'), name: '', integration: 'shop', endpoint: 'get-y' },
  ]
  it('sends one newEndpoint per key, later rows link to it; blank names and links are left out', () => {
    expect(acceptPayload(rows, integrations)).toEqual([
      { id: 'a', integration: 'shop', newEndpoint: { key: 'get-items-1', name: 'GET /items/1' } },
      { id: 'b', name: 'Second', integration: 'shop', endpoint: 'get-items-1' },
      { id: 'c' },
      { id: 'd', integration: 'shop', endpoint: 'get-y' },
    ])
  })
})

it('formatBytes', () => {
  expect(formatBytes(0)).toBe('0 B')
  expect(formatBytes(1023)).toBe('1023 B')
  expect(formatBytes(2048)).toBe('2.0 KB')
  expect(formatBytes(3 * 1024 * 1024)).toBe('3.0 MB')
})
