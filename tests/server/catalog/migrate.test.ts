import { describe, expect, it } from 'vitest'
import { legacyEndpointsOf, migrateLinkedStubs } from '../../../src/server/catalog/migrate'
import type { StubMapping } from '../../../src/server/wiremock/types'
import { responsesFromStubs } from '../../../src/ui/lib/groups'

const linked = (id: string, request: Record<string, unknown>, extra: Record<string, unknown> = {}, endpoint: string | undefined = 'get-post') =>
  ({
    id,
    name: `Get post — ${id}`,
    request,
    response: { status: 200, body: id },
    metadata: { wiremockUi: { integration: 'blog', ...(endpoint ? { endpoint } : {}), owner: 'sara', tags: ['old'] } },
    ...extra,
  }) as unknown as StubMapping

const endpoints = legacyEndpointsOf([
  { integration: 'blog', key: 'get-post', name: 'Get post', lookup: { location: 'path', expression: 'id' } },
  { integration: 'blog', key: 'list', name: 'List posts' },
  'junk',
])

describe('integrations become tags, endpoint mocks become one mock with several responses', () => {
  it('key mocks are responses by value, the default mock is "any other"; names follow the endpoint', () => {
    const base = { method: 'GET', urlPathTemplate: '/blog/posts/{id}' }
    const out = migrateLinkedStubs(
      [
        linked('p2', { ...base, pathParameters: { id: { equalTo: 'p-2' } } }, { priority: 5 }),
        linked('def', base, { priority: 10 }),
        linked('p1', { ...base, pathParameters: { id: { equalTo: 'p-1' } } }, { priority: 5 }),
      ],
      endpoints,
    )
    expect(out.map((s) => [s.id, s.name, s.metadata!.wiremockUi])).toEqual([
      ['p2', 'Get post', { owner: 'sara', tags: ['old', 'blog'], group: { id: 'endpoint-blog-get-post', by: [{ location: 'path', expression: 'id' }], values: ['p-2'], order: 1 } }],
      ['def', 'Get post', { owner: 'sara', tags: ['old', 'blog'], group: { id: 'endpoint-blog-get-post', by: [{ location: 'path', expression: 'id' }], order: 2 } }],
      ['p1', 'Get post', { owner: 'sara', tags: ['old', 'blog'], group: { id: 'endpoint-blog-get-post', by: [{ location: 'path', expression: 'id' }], values: ['p-1'], order: 0 } }],
    ])
    expect(out[0]!.request).toEqual({ ...base, pathParameters: { id: { equalTo: 'p-2' } } })
    // The editor can open the result.
    const read = responsesFromStubs([out[2]!, out[0]!, out[1]!])
    expect(read).toMatchObject({ form: { name: 'Get post', quick: { urlType: 'template', priority: '5' } }, responses: { rows: [{ values: ['p-1'] }, { values: ['p-2'] }], fallbackOn: true } })
  })

  it('a lone default mock, an endpoint without a key or a missing endpoint become plain mocks with the tag', () => {
    const out = migrateLinkedStubs(
      [
        linked('only-default', { method: 'GET', urlPathTemplate: '/blog/posts/{id}' }),
        linked('list', { method: 'GET', urlPath: '/blog/posts' }, {}, 'list'),
        linked('gone', { method: 'GET', urlPath: '/blog/x' }, {}, 'nope'),
        linked('guessed', { method: 'GET', urlPath: '/blog/y' }, {}, undefined),
      ],
      endpoints,
    )
    for (const s of out) expect(s.metadata!.wiremockUi).toEqual({ owner: 'sara', tags: ['old', 'blog'] })
    expect(out[0]!.name).toBe('Get post — only-default')
  })

  it('leaves unlinked stubs alone', () => {
    const plain = { id: 'x', request: { method: 'GET', urlPath: '/x' }, response: { status: 200 } } as unknown as StubMapping
    expect(migrateLinkedStubs([plain], endpoints)[0]).toBe(plain)
  })
})
