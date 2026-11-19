import bcrypt from 'bcryptjs'

export function hashPassword(plain: string, cost = 12): Promise<string> {
  return bcrypt.hash(plain, cost)
}

export function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash)
}
