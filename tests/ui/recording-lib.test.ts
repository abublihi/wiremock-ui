import { describe, expect, it } from 'vitest'
import type { Endpoint, Integration } from '@/server/catalog/types'
import type { ReviewItem } from '@/server/recording/types'
import { acceptPayload, formatBytes, groupReviewItems, NEW_ENDPOINT, newEndpointFor, suggestLink, type RowChoice } from '@/ui/lib/recording'

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

describe('groupReviewItems', () => {
  const step = (id: string, scenario: string, required: string, next?: string): ReviewItem => {
    const base = item('GET', '/shop/items', id)
    return { ...base, stub: { ...base.stub, scenarioName: scenario, requiredScenarioState: required, ...(next ? { newScenarioState: next } : {}) } }
  }
  it('keeps plain rows on their own and puts a recorded scenario in one group, in answer order', () => {
    const a = item('GET', '/a')
    const s3 = step('s3', 'scn', 'scn-3')
    const s1 = step('s1', 'scn', 'Started', 'scn-2')
    const s2 = step('s2', 'scn', 'scn-2', 'scn-3')
    const b = item('GET', '/b')
    const groups = groupReviewItems([a, s3, s1, b, s2])
    expect(groups.map((g) => [g.scenario, g.items.map((i) => i.id)])).toEqual([
      [undefined, ['/a']],
      ['scn', ['s1', 's2', 's3']],
      [undefined, ['/b']],
    ])
  })
  it('falls back to list order when the chain is broken', () => {
    const groups = groupReviewItems([step('x2', 's', 's-2'), step('x9', 's', 'odd')])
    expect(groups[0].items.map((i) => i.id)).toEqual(['x2', 'x9'])
  })
})

describe('withoutScenario', () => {
  it('drops the scenario fields and the server-owned ones, keeping the catalog link', async () => {
    const { withoutScenario } = await import('@/ui/lib/recording')
    const stub = {
      id: 'm1', uuid: 'm1', name: 'GET /a', request: { method: 'GET', urlPath: '/a' }, response: { status: 200 },
      scenarioName: 's', requiredScenarioState: 'Started', newScenarioState: 's-2',
      metadata: { wiremockUi: { integration: 'shop', endpoint: 'get-a', owner: 'sara', version: 1 } },
    }
    expect(withoutScenario(stub as never)).toEqual({
      name: 'GET /a', request: { method: 'GET', urlPath: '/a' }, response: { status: 200 },
      metadata: { wiremockUi: { integration: 'shop', endpoint: 'get-a' } },
    })
  })
})

describe('empty recording message', () => {
  it('lists the paths that went through, to compare with the filters', async () => {
    const { emptyMessage, filtersText } = await import('@/ui/components/recording/RecordForms')
    const text = emptyMessage({ reason: 'filtered', requests: 2, filters: { urlPathPattern: '^/api/.*$' }, paths: ['/shop/items/1', '/health'] }, 'recording')
    expect(text).toContain('2 requests went through the recording but none matched your filters (path pattern ^/api/.*$).')
    expect(text).toContain('Paths that went through: /shop/items/1, /health')
    expect(filtersText({ method: 'GET' })).toBe('method GET')
    expect(filtersText(undefined)).toBeNull()
  })
})

describe('path filter checks', () => {
  it('spots * used the wildcard way inside a regex', async () => {
    const { wildcardStarInRegex } = await import('@/ui/components/recording/RecordForms')
    expect(wildcardStarInRegex('^/api/*')).toBe(true)
    expect(wildcardStarInRegex('*')).toBe(true)
    expect(wildcardStarInRegex('^/api/.*$')).toBe(false)
    expect(wildcardStarInRegex('/a[0-9]*')).toBe(false)
  })
})
