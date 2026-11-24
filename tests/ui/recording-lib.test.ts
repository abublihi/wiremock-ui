import { describe, expect, it } from 'vitest'
import type { ReviewItem } from '@/server/recording/types'
import { acceptPayload, formatBytes, groupReviewItems, suggestTags, type RowChoice } from '@/ui/lib/recording'

const item = (method: string, url: string, id = url): ReviewItem => ({
  id, method, url, status: 200, bodySize: 1, stub: { name: `${method} ${url}`, request: { method, urlPath: url.split('?')[0] }, response: { status: 200 } },
})

describe('suggestTags', () => {
  it('suggests the first part of the path, as import does; none for a pattern or the root', () => {
    expect(suggestTags(item('GET', '/Shop/items/1?x=1'))).toEqual(['shop'])
    expect(suggestTags(item('GET', '/health'))).toEqual(['health'])
    expect(suggestTags(item('GET', '/'))).toEqual([])
  })
})

describe('acceptPayload', () => {
  const rows: (RowChoice & { item: ReviewItem })[] = [
    { item: item('GET', '/shop/items/1', 'a'), name: '', tags: ['shop'] },
    { item: item('GET', '/x', 'b'), name: '  Second ', tags: [] },
  ]
  it('sends the name (trimmed) and the tags; blank names and empty tag lists are left out', () => {
    expect(acceptPayload(rows)).toEqual([{ id: 'a', tags: ['shop'] }, { id: 'b', name: 'Second' }])
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
