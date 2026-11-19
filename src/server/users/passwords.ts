import bcrypt from 'bcryptjs'

export function hashPassword(plain: string, cost = 12): Promise<string> {
  return bcrypt.hash(plain, cost)
}

export function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash)
}

let dummyHash: Promise<string> | undefined

/** Verifies against `hash`, or a throwaway hash when there is none, so unknown users cost the same as wrong passwords. */
export async function verifyPasswordOrDummy(plain: string, hash: string | undefined): Promise<boolean> {
  dummyHash ??= hashPassword('dummy-password')
  const ok = await verifyPassword(plain, hash ?? (await dummyHash))
  return hash !== undefined && ok
}
