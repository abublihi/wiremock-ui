import { expect, test } from 'vitest'
import { MockService } from '../../../src/server/mocks/service'
import type { StubMapping } from '../../../src/server/wiremock/types'

test('WireMock-only mode: a save whose read-back fails still answers with the written mock', async () => {
  const saved: StubMapping[] = []
  let reads = 0
  const store = {
    // The read-back after the save fails.
    get: async () => {
      reads++
      throw new Error('WireMock went away')
    },
    save: async (stub: StubMapping) => void saved.push(stub),
  }
  const svc = new MockService({
    wiremock: {} as never,
    store: store as never,
    audit: { record: async () => {}, list: async () => ({ entries: [], nextCursor: null }) },
    storeIsWireMock: true,
  })
  const mock = await svc.create({ name: 'Hi', request: { method: 'GET', urlPath: '/hi' }, response: { status: 200 } }, { username: 'ann' } as never)
  expect(mock).toMatchObject({ name: 'Hi', persistent: false, metadata: { wiremockUi: { owner: 'ann', version: 1 } } })
  expect(saved).toHaveLength(1)
  expect(reads).toBe(1)
})
