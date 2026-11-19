import { expect, test } from 'vitest'
import { hashPassword, verifyPassword } from '../../../src/server/users/passwords'

test('hashPassword/verifyPassword round-trip; wrong password false; hash is bcrypt', async () => {
  const hash = await hashPassword('s3cret', 4)
  expect(hash.startsWith('$2')).toBe(true)
  expect(await verifyPassword('s3cret', hash)).toBe(true)
  expect(await verifyPassword('wrong', hash)).toBe(false)
})
