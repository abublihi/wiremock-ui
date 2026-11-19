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

export type PublicUser = Omit<User, 'passwordHash'>

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
  /** INCR ratelimit:login:{ip}; EXPIRE windowSeconds on first hit. Returns the new count. */
  hitRateLimit(ip: string, windowSeconds: number): Promise<number>
}
