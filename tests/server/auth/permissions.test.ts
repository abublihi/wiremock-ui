import { expect, test } from 'vitest'
import { can, canEditMock } from '../../../src/server/auth/permissions'
import type { Permission } from '../../../src/server/auth/permissions'

const permissions: Permission[] = [
  'mocks.read', 'mocks.create', 'mocks.editOwn', 'mocks.editAny', 'mocks.editBaseline',
  'catalog.read', 'catalog.write', 'catalog.delete', 'requests.read', 'requests.clear',
  'users.manage', 'audit.read', 'import.run',
]

test.each(permissions)('spec A8: every signed-in user has %s', (permission) => {
  expect(can(permission)).toBe(true)
})

test('spec A8: anyone can edit any mock, including baseline', () => {
  expect(canEditMock()).toBe(true)
})
