export type Role = 'viewer' | 'tester' | 'developer' | 'admin'

export type User = {
  id: string
  username: string
  displayName: string
  role: Role
  passwordHash: string
  disabled: boolean
  createdAt: string
  updatedAt: string
}

// Spec A8: role is stored but not part of the API.
export type PublicUser = Omit<User, 'passwordHash' | 'role'>

export type Session = {
  id: string
  userId: string
  csrfToken: string
  createdAt: string
  expiresAt: string
}

export interface UserStore {
  getUser(id: string): Promise<User | null>
  /** Case-insensitive. */
  getUserByName(username: string): Promise<User | null>
  /** Sorted by username. */
  listUsers(): Promise<User[]>
  /** ConflictError('Username already exists') if the name is taken. */
  createUser(user: User): Promise<void>
  /** Keeps users:by-name in sync on rename. */
  updateUser(user: User): Promise<void>
  /** Also deletes that user's sessions. */
  deleteUser(id: string): Promise<void>
  countUsers(): Promise<number>
  createSession(userId: string, ttlSeconds: number): Promise<Session>
  getSession(id: string): Promise<Session | null>
  deleteSession(id: string): Promise<void>
  deleteSessionsOf(userId: string): Promise<void>
  /** Atomically INCR ratelimit:login:{ip}; sets EXPIRE windowSeconds whenever the key has no TTL. Returns the new count. */
  hitRateLimit(ip: string, windowSeconds: number): Promise<number>
  /** DECR ratelimit:login:{ip}, never below 0 (an attempt that succeeded or was never verified). */
  releaseRateLimit(ip: string): Promise<void>
  /** Deletes all of the user's sessions except keepId. */
  deleteOtherSessions(userId: string, keepId: string): Promise<void>
}

export function toPublicUser(user: User): PublicUser {
  const { passwordHash: _passwordHash, role: _role, ...rest } = user
  return rest
}
