import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseSourceFile } from '@/ui/lib/import-files'
import {
  commonFirstSegment,
  defaultIntegration,
  isPostmanCollection,
  MAX_FOLDER_DEPTH,
  mockId,
  sha1,
  uuidFromName,
  parsePostman,
  pathUnder,
  planPostman,
  slugify,
  uniqueKey,
  type PlanOptions,
} from '@/ui/lib/postman'

const fixture = (name: string) => readFileSync(join(process.cwd(), 'tests/fixtures/postman', name), 'utf8')
const shop = () => parsePostman(JSON.parse(fixture('shop-v2.1.json')))
const legacy = () => parsePostman(JSON.parse(fixture('legacy-v2.0.json')))
const integration = { key: 'shop', name: 'Shop API', prefix: '/api' }
const plan = (opts: Partial<PlanOptions> = {}) => planPostman(shop(), { integration, ...opts })

describe('detecting a collection', () => {
  it('knows v2.0 and v2.1 by info.schema, nothing else', () => {
    expect(isPostmanCollection(JSON.parse(fixture('shop-v2.1.json')))).toBe(true)
    expect(isPostmanCollection(JSON.parse(fixture('legacy-v2.0.json')))).toBe(true)
    expect(isPostmanCollection({ info: { schema: 'https://schema.postman.com/json/collection/v2.1.0/' } })).toBe(true)
    expect(isPostmanCollection({ info: { schema: 'https://schema.getpostman.com/json/collection/v1.0.0/collection.json' } })).toBe(false)
    expect(isPostmanCollection({ mappings: [] })).toBe(false)
    expect(isPostmanCollection([])).toBe(false)
  })

  it('a picked file that is a collection carries it (and an empty bundle)', () => {
    const r = parseSourceFile({ path: 'shop.postman_collection.json', text: fixture('shop-v2.1.json') })
    expect(r.ok && r.postman?.name).toBe('Shop API')
    expect(r.ok && r.summary).toEqual({ integrations: 0, endpoints: 0, mocks: 0, oidcIdentities: 0 })
    const plain = parseSourceFile({ path: 'a.json', text: JSON.stringify({ mappings: [] }) })
    expect(plain.ok && plain.postman).toBeUndefined()
  })
})

describe('parsing v2.1', () => {
  it('walks folders and reads method, path, query, headers and bodies', () => {
    const c = shop()
    expect(c.requests.map((r) => [r.folder.join('/'), r.name, r.request.method, r.request.path])).toEqual([
      ['Orders', 'Get order', 'GET', '/api/orders/{orderId}'],
      ['Orders', 'Search orders', 'GET', '/api/orders'],
      ['Orders', 'Create order', 'POST', '/api/orders'],
      ['Customers', 'Sign in', 'POST', '/api/login'],
      ['Customers', 'Customer graph', 'POST', '/api/graphql'],
    ])
    const [get, search, create, signIn, graph] = c.requests
    expect(get.request.pathVars).toEqual({ orderId: '1' })
    expect(get.description).toBe('One order by id')
    expect(get.request.headers).toEqual({ accept: 'application/json' })
    // Disabled query parameters are left out.
    expect(search.request.query).toEqual([['status', 'pending']])
    expect(create.request.body).toEqual({ kind: 'json', text: '{"sku": "A-1", "qty": 1}' })
    expect(signIn.request.body).toEqual({ kind: 'form', text: 'user=sara&password=secret' })
    expect(graph.request.body).toBeUndefined()
    expect(graph.notes).toEqual([{ key: 'postman.noteGraphql', params: { name: 'Customer graph' } }])
  })

  it('reads saved examples with status, Content-Type, body and original request', () => {
    const [get] = shop().requests
    expect(get.examples.map((e) => [e.name, e.status, e.contentType, e.body])).toEqual([
      ['Order found', 200, 'application/json; charset=utf-8', '{"id": 1, "status": "pending"}'],
      ['Order missing', 404, 'application/json', '{"error": "order not found"}'],
    ])
    expect(get.examples[1].request?.pathVars).toEqual({ orderId: '999' })
  })

  it('warns about auth helpers and scripts', () => {
    expect(shop().warnings.map((w) => w.key)).toEqual(['postman.warnAuth', 'postman.warnScripts'])
  })
})

describe('parsing v2.0', () => {
  it('reads string URLs and text headers; drops the host; {{var}} segments become template params', () => {
    const c = legacy()
    const [invoice, health] = c.requests
    expect(invoice.request.path).toBe('/billing/invoices/{invoiceId}')
    expect(invoice.request.query).toEqual([['expand', 'lines']])
    expect(invoice.request.headers).toEqual({ accept: 'application/xml' })
    expect(invoice.notes).toEqual([{ key: 'postman.noteUnresolved', params: { name: 'Invoice', variable: 'invoiceId' } }])
    expect(invoice.examples.map((e) => e.contentType)).toEqual(['application/xml', 'application/xml'])
    expect(health.request).toMatchObject({ method: 'GET', path: '/billing/health' })
    expect(c.warnings).toEqual([{ key: 'postman.warnMethod', params: { name: 'Odd method', method: 'PURGE' } }])
  })

  it('resolves {{var}} from collection variables, and keeps raw-URL forms apart', () => {
    const c = parsePostman({
      info: { name: 'V', schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json' },
      variable: [{ key: 'version', value: 'v2' }],
      item: [
        { name: 'a', request: { method: 'GET', url: '{{host}}/{{version}}/things/:id/' } },
        { name: 'b', request: { method: 'GET', url: 'example.com/x?y=1#frag' } },
        { name: 'c', request: { method: 'GET', url: { raw: '{{host}}' } } },
      ],
    })
    expect(c.requests.map((r) => r.request.path)).toEqual(['/v2/things/{id}/', '/x', '/'])
    expect(c.requests[1].request.query).toEqual([['y', '1']])
  })
})

describe('mapping helpers', () => {
  it('slugs, unique keys, prefixes', () => {
    expect(slugify('Get order (v2)!')).toBe('get-order-v2')
    expect(slugify('Ünïcode café')).toBe('unicode-cafe')
    expect(slugify('***')).toBe('item')
    expect(slugify('x'.repeat(80))).toHaveLength(63)
    expect(uniqueKey('a', new Set(['a', 'a-2']))).toBe('a-3')
    expect(uniqueKey('x'.repeat(63), new Set(['x'.repeat(63)]))).toBe(`${'x'.repeat(61)}-2`)
    expect(defaultIntegration(shop())).toEqual({ key: 'shop-api', name: 'Shop API', prefix: '/shop-api' })
    expect(commonFirstSegment(shop())).toBe('/api')
    expect(commonFirstSegment(legacy())).toBe('/billing')
    expect(pathUnder('/api', '/api/orders')).toBe('/orders')
    expect(pathUnder('/api', '/apix/orders')).toBe('/apix/orders')
    expect(pathUnder('/', '/api/orders')).toBe('/api/orders')
  })
})

describe('planning the import', () => {
  it('one integration; one endpoint per request with key, path type, content type, examples and statuses', () => {
    const p = plan()
    expect(p.bundle.integrations).toEqual([{ key: 'shop', name: 'Shop API', prefix: '/api' }])
    expect(p.rows.map((r) => [r.key, r.method, r.path, r.url])).toEqual([
      ['get-order', 'GET', '/orders/{orderId}', '/api/orders/{orderId}'],
      ['search-orders', 'GET', '/orders', '/api/orders'],
      ['create-order', 'POST', '/orders', '/api/orders'],
      ['sign-in', 'POST', '/login', '/api/login'],
      ['customer-graph', 'POST', '/graphql', '/api/graphql'],
    ])
    const get = p.bundle.catalog[0]
    expect(get).toEqual({
      integration: 'shop',
      key: 'get-order',
      name: 'Get order',
      method: 'GET',
      path: '/orders/{orderId}',
      pathType: 'template',
      contentType: 'json',
      exampleResponses: { '200': '{\n  "id": 1,\n  "status": "pending"\n}', '404': '{\n  "error": "order not found"\n}' },
      allowedStatuses: [200, 404],
      description: 'One order by id',
    })
    expect(get).not.toHaveProperty('lookup')
    expect(p.bundle.catalog[2]).toMatchObject({ pathType: 'exact', exampleRequest: '{\n  "sku": "A-1",\n  "qty": 1\n}', allowedStatuses: [201, 409] })
    // A request without examples is an endpoint with no mocks.
    expect(p.bundle.catalog[4]).toMatchObject({ key: 'customer-graph', exampleResponses: {}, allowedStatuses: [] })
    expect(p.rows[4].mocks).toBe(0)
  })

  it('the default example (first 2xx) is a priority 10 mock the Simple builder would write', () => {
    const p = plan()
    const stub = p.bundle.mocks.find((m) => m.name === 'Get order — Order found')!
    expect(stub).toEqual({
      id: mockId('shop', 'get-order', { id: 'r0e0', name: 'Order found' }),
      name: 'Get order — Order found',
      priority: 10,
      request: { method: 'GET', urlPathTemplate: '/api/orders/{orderId}' },
      response: { status: 200, headers: { 'Content-Type': 'application/json' }, jsonBody: { id: 1, status: 'pending' } },
      metadata: { wiremockUi: { integration: 'shop', endpoint: 'get-order' } },
    })
  })

  it('other examples get priority 5 and a matcher from their original request', () => {
    const mocks = plan().bundle.mocks
    const byName = (n: string) => mocks.find((m) => m.name === n)!
    expect(byName('Get order — Order missing')).toMatchObject({ priority: 5, request: { pathParameters: { orderId: { equalTo: '999' } } } })
    expect(byName('Search orders — Shipped orders').request).toEqual({ method: 'GET', urlPath: '/api/orders', queryParameters: { status: { equalTo: 'shipped' } } })
    expect(byName('Create order — Out of stock').request).toEqual({
      method: 'POST',
      urlPath: '/api/orders',
      bodyPatterns: [{ equalToJson: '{"sku": "Z-9", "qty": 1}', ignoreExtraElements: true }],
    })
    expect(byName('Sign in — Wrong password').request).toMatchObject({ formParameters: { password: { equalTo: 'wrong' } } })
  })

  it('lists examples with no distinguishing request as skipped', () => {
    const search = plan().rows[1]
    expect(search.mocks).toBe(2)
    expect(search.skipped).toEqual([{ name: 'Pending again', reason: 'postman.skipSameRequest' }])
    const health = planPostman(legacy(), { integration: { key: 'b', name: 'B', prefix: '/billing' } }).rows[1]
    expect(health.skipped).toEqual([{ name: 'Down', reason: 'postman.skipNoRequest' }])
  })

  it('the user picks another default example', () => {
    const p = plan({ choices: { r0: { defaultExample: 'r0e1' } } })
    const get = p.bundle.mocks.filter((m) => m.metadata?.wiremockUi?.endpoint === 'get-order')
    expect(get.map((m) => [m.name, m.priority])).toEqual([
      ['Get order — Order missing', 10],
      ['Get order — Order found', 5],
    ])
  })

  it('v2.0: xml and text endpoints write body, not jsonBody', () => {
    const p = planPostman(legacy(), { integration: { key: 'billing', name: 'Billing', prefix: '/billing' } })
    expect(p.rows.map((r) => r.key)).toEqual(['invoice', 'health'])
    expect(p.bundle.catalog[0]).toMatchObject({ path: '/invoices/{invoiceId}', pathType: 'template', contentType: 'xml' })
    expect(p.bundle.mocks[0].response).toEqual({ status: 200, headers: { 'Content-Type': 'application/xml' }, body: '<invoice id="7"/>' })
    expect(p.bundle.mocks[1].request).toMatchObject({ queryParameters: { expand: { equalTo: 'none' } } })
    expect(p.bundle.catalog[1]).toMatchObject({ contentType: 'text', allowedStatuses: [200, 503] })
  })

  it('keys stay unique within the collection', () => {
    const c = parsePostman({
      info: { name: 'Dup', schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json' },
      item: [
        { name: 'List', request: { method: 'GET', url: '/a' } },
        { name: 'List', request: { method: 'GET', url: '/b' } },
      ],
    })
    expect(planPostman(c, { integration: { key: 'd', name: 'D', prefix: '/' } }).rows.map((r) => r.key)).toEqual(['list', 'list-2'])
  })

  describe('into an existing integration', () => {
    const existing = { integration: { key: 'shop', name: 'Shop (stored)', prefix: '/api' }, endpointKeys: ['get-order', 'sign-in', 'get-order-2'] }

    it('keeps the stored integration and does not send it', () => {
      const p = plan({ existing })
      expect(p.addsToExisting).toBe(true)
      expect(p.bundle.integrations).toEqual([])
      expect(p.rows.filter((r) => r.conflict).map((r) => r.proposedKey)).toEqual(['get-order', 'sign-in'])
    })

    it('Create new (the default) renames with the next free suffix', () => {
      const p = plan({ existing })
      expect(p.rows.map((r) => r.key)).toEqual(['get-order-3', 'search-orders', 'create-order', 'sign-in-2', 'customer-graph'])
      expect(p.bundle.mocks.filter((m) => m.name?.startsWith('Get order')).every((m) => m.metadata?.wiremockUi?.endpoint === 'get-order-3')).toBe(true)
    })

    it('Overwrite keeps the key; Skip leaves the row out entirely', () => {
      const p = plan({ existing, choices: { r0: { action: 'overwrite' }, r3: { action: 'skip' } } })
      expect(p.rows[0].key).toBe('get-order')
      expect(p.bundle.catalog.map((e) => (e as { key: string }).key)).toEqual(['get-order', 'search-orders', 'create-order', 'customer-graph'])
      expect(p.bundle.mocks.some((m) => m.name?.startsWith('Sign in'))).toBe(false)
      expect(p.endpoints).toBe(4)
    })

    it('Overwrite on a row without a conflict is just a create', () => {
      expect(plan({ existing, choices: { r1: { action: 'overwrite' } } }).rows[1].action).toBe('create')
    })
  })
})

describe('mock ids', () => {
  it('sha1 matches node:crypto, including multi-byte text and multi-block input', () => {
    for (const text of ['', 'abc', 'héllo wörld '.repeat(20), 'x'.repeat(55), 'x'.repeat(56), 'x'.repeat(64)]) {
      expect(Buffer.from(sha1(text)).toString('hex')).toBe(createHash('sha1').update(text).digest('hex'))
    }
  })

  it('are version-5 UUIDs, stable per integration + endpoint + example, different otherwise', () => {
    expect(uuidFromName('a')).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
    const ids = (p: ReturnType<typeof plan>) => p.bundle.mocks.map((m) => m.id)
    expect(ids(plan())).toEqual(ids(plan()))
    expect(new Set(ids(plan())).size).toBe(plan().mocks)
    // "Create new" on a re-import: the -2 endpoints get mocks of their own.
    const existing = { integration, endpointKeys: plan().rows.map((r) => r.key) }
    const again = planPostman(shop(), { integration, existing })
    expect(again.rows.every((r) => r.key.endsWith('-2'))).toBe(true)
    expect(ids(again).filter((id) => ids(plan()).includes(id))).toEqual([])
    // Overwrite keeps the key, so the same ids: an update, not a duplicate.
    const overwrite = planPostman(shop(), { integration, existing, choices: Object.fromEntries(again.rows.map((r) => [r.id, { action: 'overwrite' as const }])) })
    expect(ids(overwrite)).toEqual(ids(plan()))
    // Another integration key (even with the same prefix) never takes over these mocks.
    expect(ids(planPostman(shop(), { integration: { ...integration, key: 'shop-copy' } })).filter((id) => ids(plan()).includes(id))).toEqual([])
  })
})

describe('odd input never crashes', () => {
  const collection = (item: unknown[]) => ({ info: { name: 'Deep', schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json' }, item })

  it('folders nested deeper than the cap make the file an error, not a crash', () => {
    let items: unknown[] = [{ name: 'leaf', request: { method: 'GET', url: '/x' } }]
    for (let i = 0; i < MAX_FOLDER_DEPTH + 5; i++) items = [{ name: `f${i}`, item: items }]
    expect(() => parsePostman(collection(items))).toThrow(/nested more than 64 deep/)
    const r = parseSourceFile({ path: 'deep.json', text: JSON.stringify(collection(items)) })
    expect(r.ok).toBe(false)
    expect(!r.ok && r.error).toEqual({ key: 'import.fileShape', params: { message: 'deep.json: folders are nested more than 64 deep' } })
    // At the cap it still reads.
    let ok: unknown[] = [{ name: 'leaf', request: { method: 'GET', url: '/x' } }]
    for (let i = 0; i < MAX_FOLDER_DEPTH; i++) ok = [{ name: `f${i}`, item: ok }]
    expect(parsePostman(collection(ok)).requests).toHaveLength(1)
  })

  it('a deeply nested JSON body plans without throwing', () => {
    const deep = '['.repeat(20000) + ']'.repeat(20000)
    const raw = (text: string) => ({ mode: 'raw', raw: text, options: { raw: { language: 'json' } } })
    const c = parsePostman(
      collection([
        {
          name: 'Deep',
          request: { method: 'POST', url: '/deep', body: raw('{}') },
          response: [
            { name: 'ok', code: 200, header: [{ key: 'Content-Type', value: 'application/json' }], body: deep, originalRequest: { method: 'POST', url: '/deep', body: raw('{}') } },
            { name: 'deep', code: 400, header: [{ key: 'Content-Type', value: 'application/json' }], body: '{}', originalRequest: { method: 'POST', url: '/deep', body: raw(deep) } },
          ],
        },
      ]),
    )
    const p = planPostman(c, { integration: { key: 'd', name: 'D', prefix: '/' } })
    expect(p.mocks).toBe(2)
  })
})
