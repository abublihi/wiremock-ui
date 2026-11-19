import type { PublicUser, Role } from '../users/types'

export type Permission =
  | 'mocks.read' | 'mocks.create' | 'mocks.editOwn' | 'mocks.editAny' | 'mocks.editBaseline'
  | 'catalog.read' | 'catalog.write' | 'catalog.delete'
  | 'requests.read' | 'requests.clear'
  | 'users.manage' | 'audit.read' | 'import.run'

const viewer: Permission[] = ['mocks.read', 'catalog.read', 'requests.read']
const tester: Permission[] = [...viewer, 'mocks.create', 'mocks.editOwn']
const developer: Permission[] = [...tester, 'mocks.editAny', 'catalog.write', 'requests.clear']
const admin: Permission[] = [...developer, 'mocks.editBaseline', 'catalog.delete', 'users.manage', 'audit.read', 'import.run']

const GRANTS: Record<Role, ReadonlySet<Permission>> = {
  viewer: new Set(viewer),
  tester: new Set(tester),
  developer: new Set(developer),
  admin: new Set(admin),
}

export function can(role: Role, permission: Permission): boolean {
  return GRANTS[role]?.has(permission) ?? false
}

/** Baseline → editBaseline; own → editOwn or editAny; others' → editAny. */
export function canEditMock(user: PublicUser, mockOwner: string): boolean {
  if (mockOwner === 'baseline') return can(user.role, 'mocks.editBaseline')
  if (mockOwner === user.username) return can(user.role, 'mocks.editOwn') || can(user.role, 'mocks.editAny')
  return can(user.role, 'mocks.editAny')
}
