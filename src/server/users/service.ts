import { randomUUID } from 'node:crypto'
import type { AuditLog } from '../audit/log'
import { LOGIN_MAX_ATTEMPTS, LOGIN_WINDOW_SECONDS, SESSION_TTL_SECONDS } from '../auth/session'
import type { Config } from '../config'
import { AppError, NotFoundError, ValidationError } from '../errors'
import { hashPassword, verifyPassword } from './passwords'
import { toPublicUser } from './types'
import type { PublicUser, Role, Session, User, UserStore } from './types'

const ROLES: Role[] = ['viewer', 'tester', 'developer', 'admin']
const RESERVED = new Set(['baseline', 'system'])
const USERNAME = /^[a-z0-9._-]{2,32}$/

function normalizeUsername(raw: string): string {
  const username = String(raw ?? '').toLowerCase()
  if (!USERNAME.test(username)) throw new ValidationError('username must be 2–32 characters: a-z, 0-9, ., _ or -')
  if (RESERVED.has(username)) throw new ValidationError(`username "${username}" is reserved`)
  return username
}

function checkPassword(password: string): void {
  if (typeof password !== 'string' || password.length < 8 || Buffer.byteLength(password) > 72) {
    throw new ValidationError('password must be 8–72 characters')
  }
}

function checkRole(role: string): asserts role is Role {
  if (!ROLES.includes(role as Role)) throw new ValidationError(`role must be one of ${ROLES.join(', ')}`)
}

const invalidLogin = () => new AppError('Invalid username or password', 401)
const isActiveAdmin = (u: User) => u.role === 'admin' && !u.disabled

export class UserService {
  private readonly users: UserStore
  private readonly audit: AuditLog
  private readonly now: () => Date
  private readonly hashCost?: number
  private dummyHash?: Promise<string>

  constructor(deps: { users: UserStore; audit: AuditLog; now?: () => Date; hashCost?: number }) {
    this.users = deps.users
    this.audit = deps.audit
    this.now = deps.now ?? (() => new Date())
    this.hashCost = deps.hashCost
  }

  private hash(plain: string) {
    return hashPassword(plain, this.hashCost)
  }

  private async otherActiveAdmins(exceptId: string): Promise<number> {
    return (await this.users.listUsers()).filter((u) => u.id !== exceptId && isActiveAdmin(u)).length
  }

  private async guardLastAdmin(target: User): Promise<void> {
    if (isActiveAdmin(target) && (await this.otherActiveAdmins(target.id)) === 0) {
      throw new AppError('At least one active admin is required', 409)
    }
  }

  private async load(id: string): Promise<User> {
    const user = await this.users.getUser(id)
    if (!user) throw new NotFoundError('User not found')
    return user
  }

  async ensureFirstAdmin(username: string, password: string): Promise<'created' | 'exists'> {
    if ((await this.users.countUsers()) > 0) return 'exists'
    const name = normalizeUsername(username)
    const ts = this.now().toISOString()
    try {
      await this.users.createUser({
        id: randomUUID(),
        username: name,
        displayName: name,
        role: 'admin',
        passwordHash: await this.hash(password),
        disabled: false,
        createdAt: ts,
        updatedAt: ts,
      })
    } catch (err) {
      if (err instanceof AppError && err.status === 409) return 'exists'
      throw err
    }
    return 'created'
  }

  async login(username: string, password: string, ip: string, _config: Config): Promise<{ user: PublicUser; session: Session }> {
    if ((await this.users.hitRateLimit(ip, LOGIN_WINDOW_SECONDS)) > LOGIN_MAX_ATTEMPTS) {
      throw new AppError('Too many attempts, try again later', 429)
    }
    const user = await this.users.getUserByName(String(username ?? ''))
    // Always run one bcrypt comparison so unknown users cost the same as wrong passwords.
    this.dummyHash ??= this.hash('dummy-password')
    const ok = await verifyPassword(String(password ?? ''), user?.passwordHash ?? (await this.dummyHash))
    if (!user || !ok || user.disabled) throw invalidLogin()
    const session = await this.users.createSession(user.id, SESSION_TTL_SECONDS)
    return { user: toPublicUser(user), session }
  }

  logout(sessionId: string): Promise<void> {
    return this.users.deleteSession(sessionId)
  }

  async list(): Promise<PublicUser[]> {
    return (await this.users.listUsers()).map(toPublicUser)
  }

  async create(input: { username: string; displayName?: string; role: Role; password: string }, actor: string): Promise<PublicUser> {
    const username = normalizeUsername(input.username)
    checkPassword(input.password)
    checkRole(input.role)
    const ts = this.now().toISOString()
    const user: User = {
      id: randomUUID(),
      username,
      displayName: input.displayName?.trim() || username,
      role: input.role,
      passwordHash: await this.hash(input.password),
      disabled: false,
      createdAt: ts,
      updatedAt: ts,
    }
    await this.users.createUser(user)
    await this.audit.record({ actor, action: 'user.create', target: username, details: { role: user.role } })
    return toPublicUser(user)
  }

  async update(
    id: string,
    patch: { displayName?: string; role?: Role; password?: string; disabled?: boolean },
    actor: string,
  ): Promise<PublicUser> {
    const current = await this.load(id)
    if (patch.role !== undefined) checkRole(patch.role)
    if (patch.password !== undefined) checkPassword(patch.password)
    const next: User = {
      ...current,
      displayName: patch.displayName?.trim() || current.displayName,
      role: patch.role ?? current.role,
      disabled: patch.disabled ?? current.disabled,
      passwordHash: patch.password !== undefined ? await this.hash(patch.password) : current.passwordHash,
      updatedAt: this.now().toISOString(),
    }
    if (isActiveAdmin(current) && !isActiveAdmin(next)) await this.guardLastAdmin(current)
    await this.users.updateUser(next)
    if (patch.password !== undefined || (patch.disabled === true && !current.disabled)) {
      await this.users.deleteSessionsOf(id)
    }
    const changed = [
      patch.displayName !== undefined && 'displayName',
      patch.role !== undefined && 'role',
      patch.password !== undefined && 'password',
      patch.disabled !== undefined && 'disabled',
    ].filter(Boolean)
    await this.audit.record({ actor, action: 'user.update', target: current.username, details: { changed } })
    return toPublicUser(next)
  }

  async remove(id: string, actor: string): Promise<void> {
    const user = await this.load(id)
    await this.guardLastAdmin(user)
    await this.users.deleteUser(id)
    await this.audit.record({ actor, action: 'user.delete', target: user.username })
  }

  async changeOwnPassword(userId: string, current: string, next: string): Promise<void> {
    const user = await this.load(userId)
    if (!(await verifyPassword(String(current ?? ''), user.passwordHash))) throw new ValidationError('Current password is incorrect')
    checkPassword(next)
    await this.users.updateUser({ ...user, passwordHash: await this.hash(next), updatedAt: this.now().toISOString() })
  }
}
