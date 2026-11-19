import { expect, test } from 'vitest'
import { can, canEditMock } from '../../../src/server/auth/permissions'
import type { Permission } from '../../../src/server/auth/permissions'
import type { PublicUser, Role } from '../../../src/server/users/types'

const roles: Role[] = ['viewer', 'tester', 'developer', 'admin']
const rows: [Permission, Role[]][] = [
  ['mocks.read', roles], ['catalog.read', roles], ['requests.read', roles],
  ['mocks.create', ['tester', 'developer', 'admin']], ['mocks.editOwn', ['tester', 'developer', 'admin']],
  ['mocks.editAny', ['developer', 'admin']], ['catalog.write', ['developer', 'admin']], ['requests.clear', ['developer', 'admin']],
  ['mocks.editBaseline', ['admin']], ['catalog.delete', ['admin']], ['users.manage', ['admin']], ['audit.read', ['admin']], ['import.run', ['admin']],
]
const matrix = rows.flatMap(([p, allowed]) => roles.map((r) => [r, p, allowed.includes(r)] as const))

test.each(matrix)('%s %s → %s', (role, permission, expected) => {
  expect(can(role, permission)).toBe(expected)
})

const u = (role: Role): PublicUser => ({ id: '1', username: 'me', displayName: 'me', role, disabled: false, createdAt: '', updatedAt: '' })

test('canEditMock: tester own ✓, tester other ✗, tester baseline ✗, developer other ✓, developer baseline ✗, admin baseline ✓', () => {
  expect(canEditMock(u('tester'), 'me')).toBe(true)
  expect(canEditMock(u('tester'), 'other')).toBe(false)
  expect(canEditMock(u('tester'), 'baseline')).toBe(false)
  expect(canEditMock(u('developer'), 'other')).toBe(true)
  expect(canEditMock(u('developer'), 'baseline')).toBe(false)
  expect(canEditMock(u('admin'), 'baseline')).toBe(true)
  expect(canEditMock(u('viewer'), 'me')).toBe(false)
})
