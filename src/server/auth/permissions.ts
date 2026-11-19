// Spec A8: no authorization — every signed-in user may do everything. Kept as a seam so roles can return later.
export type Permission =
  | 'mocks.read' | 'mocks.create' | 'mocks.editOwn' | 'mocks.editAny' | 'mocks.editBaseline'
  | 'catalog.read' | 'catalog.write' | 'catalog.delete'
  | 'requests.read' | 'requests.clear'
  | 'users.manage' | 'audit.read' | 'import.run'

export function can(_permission: Permission): boolean {
  return true
}

export function canEditMock(): boolean {
  return true
}
