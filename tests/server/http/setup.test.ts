import { expect, test } from 'vitest'
import { getSetup } from '../../../src/server/http/handlers/setup'
import type { Runtime } from '../../../src/server/runtime'

const runtimeWith = (accounts: number) => ({ stores: { users: { countUsers: async () => accounts } } }) as unknown as Runtime

test('GET /api/setup answers without credentials whether the first account is still to be made, and how', async () => {
  const none = await getSetup(runtimeWith(0), new Request('http://ui.test/api/setup'))
  expect(none.status).toBe(200)
  expect(none.headers.get('cache-control')).toBe('no-store')
  expect(await none.json()).toEqual({ needsFirstAdmin: true, command: 'wiremock-ui create-admin' })
  const some = await getSetup(runtimeWith(2), new Request('http://ui.test/api/setup'))
  expect(await some.json()).toEqual({ needsFirstAdmin: false, command: 'wiremock-ui create-admin' })
})
