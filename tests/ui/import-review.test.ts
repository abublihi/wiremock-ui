import { describe, expect, it } from 'vitest'
import { emptyBundle } from '@/server/bundle/shape'
import type { StubMapping } from '@/server/wiremock/types'
import { firstSegment, groupForReview, initialReview, reviewedBundle } from '@/ui/lib/import-review'

const stub = (url: string, extra: Record<string, unknown> = {}) =>
  ({ request: { method: 'GET', urlPath: url }, response: { status: 200 }, ...extra }) as unknown as StubMapping

describe('import review: suggestions', () => {
  it('takes the first plain path segment, normalised; regex or template starts give none', () => {
    expect(firstSegment('/Ajeer-App/api/x')).toBe('ajeer-app')
    expect(firstSegment('/health')).toBe('health')
    expect(firstSegment('/health?x=1')).toBe('health')
    expect(firstSegment('/.*')).toBeUndefined()
    expect(firstSegment('/{id}/x')).toBeUndefined()
    expect(firstSegment(undefined)).toBeUndefined()
  })

  it('groups by own tags, then integration, then URL start; biggest first, tagged and none last', () => {
    const mocks = [
      stub('/ajeer-app/a'),
      stub('/qiwa/x', { metadata: { wiremockUi: { integration: 'Qiwa' } } }),
      stub('/ajeer-app/b'),
      stub('/x', { metadata: { wiremockUi: { tags: ['mine'] } } }),
      { request: { method: 'GET', urlPathPattern: '/.*' }, response: { status: 200 } } as unknown as StubMapping,
      {} as StubMapping,
    ]
    const groups = groupForReview({ mocks })
    expect(groups.map((g) => [g.key, g.tag, g.indexes])).toEqual([
      ['p:ajeer-app', 'ajeer-app', [0, 2]],
      ['i:qiwa', 'qiwa', [1]],
      ['__tagged__', '', [3]],
      ['__none__', '', [4, 5]],
    ])
  })
})

describe('import review: what is sent', () => {
  const bundle = { ...emptyBundle(), mocks: [stub('/a/1'), stub('/a/2'), stub('/b/1', { metadata: { wiremockUi: { tags: ['keep'] }, other: 1 } })] }
  const groups = groupForReview(bundle)

  it('accepted group tags by default; own tags kept; nothing else changes', () => {
    const { bundle: sent, sent: order } = reviewedBundle(bundle, groups, initialReview(groups))
    expect(order).toEqual([0, 1, 2])
    expect(sent.mocks.map((m) => m.metadata?.wiremockUi?.tags)).toEqual([['a'], ['a'], ['keep']])
    expect(sent.mocks[2]!.metadata).toEqual({ wiremockUi: { tags: ['keep'] }, other: 1 })
    expect(sent.mocks[0]!.request).toEqual(bundle.mocks[0]!.request)
  })

  it('a renamed tag, a tag turned off, unticked mocks and added tags', () => {
    const state = initialReview(groups)
    const renamed = reviewedBundle(bundle, groups, { ...state, tags: { ...state.tags, 'p:a': 'Team A' }, off: [1], extra: { 0: ['sprint-1'], 2: ['sprint-1'] } })
    expect(renamed.sent).toEqual([0, 2])
    expect(renamed.bundle.mocks.map((m) => m.metadata?.wiremockUi?.tags)).toEqual([['team-a', 'sprint-1'], ['keep', 'sprint-1']])

    const turnedOff = reviewedBundle(bundle, groups, { ...state, accepted: { ...state.accepted, 'p:a': false } })
    expect(turnedOff.bundle.mocks[0]!.metadata).toBeUndefined()

    const badTag = reviewedBundle(bundle, groups, { ...state, tags: { ...state.tags, 'p:a': 'no/slash' } })
    expect(badTag.bundle.mocks[0]!.metadata).toBeUndefined()
  })
})
