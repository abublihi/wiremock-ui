import { expect, test, vi } from 'vitest'
import { RequestJournal } from '../../../src/server/requests/journal'

test('the unmatched count reads WireMock once for callers within a few seconds, stops at the window, and clears with the log', async () => {
  const now = Date.now()
  const listUnmatchedRequests = vi.fn(async () => [
    { url: '/a', method: 'GET', loggedDate: now - 1000 },
    { url: '/__wiremock-ui/marker', method: 'GET', loggedDate: now - 2000 },
    { url: '/b', method: 'GET', loggedDate: now - 60 * 60_000 },
  ])
  const journal = new RequestJournal({
    wiremock: { listUnmatchedRequests, clearRequests: async () => {} } as never,
    audit: { record: async () => {}, list: async () => ({ entries: [], nextCursor: null }) },
  })
  const [a, b] = await Promise.all([journal.countUnmatchedSince(now - 15 * 60_000, 100), journal.countUnmatchedSince(now - 15 * 60_000, 100)])
  expect(a).toEqual({ count: 1, capped: false })
  expect(b).toEqual(a)
  expect(await journal.countUnmatchedSince(now - 2 * 60 * 60_000, 100)).toEqual({ count: 2, capped: false })
  expect(listUnmatchedRequests).toHaveBeenCalledTimes(1)
  await journal.clear('ann')
  await journal.countUnmatchedSince(now - 15 * 60_000, 100)
  expect(listUnmatchedRequests).toHaveBeenCalledTimes(2)
})
