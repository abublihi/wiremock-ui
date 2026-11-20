import { randomUUID } from 'node:crypto'
import { safeRecord, type AuditLog } from '../audit/log'
import { SESSION_TTL_SECONDS, limitLoginAttempts } from '../auth/session'
import type { Config } from '../config'
import { AppError, ConfigError, NotFoundError, ValidationError } from '../errors'
import { NO_USER_MANAGEMENT } from '../store/memory'
import { hashPassword, verifyPassword, verifyPasswordOrDummy } from './passwords'
import { toPublicUser } from './types'
import type { PublicUser, Session, User, UserStore } from './types'

const RESERVED = new Set(['baseline', 'system', 'wiremock'])
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

const invalidLogin = () => new AppError('Invalid username or password', 401)
const isActive = (u: User) => !u.disabled

export class UserService {
  private readonly users: UserStore
  private readonly audit: AuditLog
  private readonly now: () => Date
  private readonly hashCost?: number
  private readonly fixedAccounts: boolean

  /** `fixedAccounts`: WireMock-only mode (spec A10) keeps the bootstrap account only; account changes are refused. */
  constructor(deps: { users: UserStore; audit: AuditLog; now?: () => Date; hashCost?: number; fixedAccounts?: boolean }) {
    this.fixedAccounts = deps.fixedAccounts ?? false
    this.users = deps.users
    this.audit = deps.audit
    this.now = deps.now ?? (() => new Date())
    this.hashCost = deps.hashCost
  }

  private hash(plain: string) {
    return hashPassword(plain, this.hashCost)
  }

  private async otherActiveUsers(exceptId: string): Promise<number> {
    return (await this.users.listUsers()).filter((u) => u.id !== exceptId && isActive(u)).length
  }

  private async guardLastActive(target: User): Promise<void> {
    if (isActive(target) && (await this.otherActiveUsers(target.id)) === 0) {
      throw new AppError('At least one active user is required', 409)
    }
  }

  private assertManaged(): void {
    if (this.fixedAccounts) throw new ValidationError(NO_USER_MANAGEMENT)
  }

  private async load(id: string): Promise<User> {
    const user = await this.users.getUser(id)
    if (!user) throw new NotFoundError('User not found')
    return user
  }

  /**
   * Accounts whose names became reserved after they were made (`baseline`, `system`, `wiremock` are owner names
   * of mocks nobody signed in made): their mocks cannot be told apart from those. Logged at boot.
   */
  async reservedAccounts(): Promise<string[]> {
    const found: string[] = []
    for (const name of RESERVED) if (await this.users.getUserByName(name)) found.push(name)
    return found
  }

  async ensureFirstAdmin(username: string, password: string): Promise<'created' | 'exists'> {
    if ((await this.users.countUsers()) > 0) return 'exists'
    let name: string
    try {
      name = normalizeUsername(username)
    } catch (err) {
      throw new ConfigError(`ADMIN_USER is invalid: ${(err as Error).message}`)
    }
    try {
      checkPassword(password)
    } catch (err) {
      throw new ConfigError(`ADMIN_PASSWORD is invalid: ${(err as Error).message}`)
    }
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
    await safeRecord(this.audit, { actor: 'system', action: 'user.create', target: name, details: { role: 'admin', bootstrap: true } })
    return 'created'
  }

  async login(username: string, password: string, ip: string, _config: Config): Promise<{ user: PublicUser; session: Session }> {
    const user = await limitLoginAttempts(this.users, ip, async () => {
      const found = await this.users.getUserByName(String(username ?? ''))
      const ok = await verifyPasswordOrDummy(String(password ?? ''), found?.passwordHash)
      return found && ok && !found.disabled ? found : null
    })
    if (!user) throw invalidLogin()
    const session = await this.users.createSession(user.id, SESSION_TTL_SECONDS)
    return { user: toPublicUser(user), session }
  }

  logout(sessionId: string): Promise<void> {
    return this.users.deleteSession(sessionId)
  }

  async list(): Promise<PublicUser[]> {
    return (await this.users.listUsers()).map(toPublicUser)
  }

  async create(input: { username: string; displayName?: string; password: string }, actor: string): Promise<PublicUser> {
    this.assertManaged()
    const username = normalizeUsername(input.username)
    checkPassword(input.password)
    const ts = this.now().toISOString()
    const user: User = {
      id: randomUUID(),
      username,
      displayName: input.displayName?.trim() || username,
      role: 'admin', // spec A8: no roles in the API; stored so data stays valid if they return
      passwordHash: await this.hash(input.password),
      disabled: false,
      createdAt: ts,
      updatedAt: ts,
    }
    await this.users.createUser(user)
    await safeRecord(this.audit, { actor, action: 'user.create', target: username, details: {} })
    return toPublicUser(user)
  }

  async update(
    id: string,
    patch: { displayName?: string; password?: string; disabled?: boolean },
    actor: string,
    opts: { keepSessionId?: string } = {},
  ): Promise<PublicUser> {
    this.assertManaged()
    const current = await this.load(id)
    if (patch.password !== undefined) checkPassword(patch.password)
    const next: User = {
      ...current,
      displayName: patch.displayName?.trim() || current.displayName,
      disabled: patch.disabled ?? current.disabled,
      passwordHash: patch.password !== undefined ? await this.hash(patch.password) : current.passwordHash,
      updatedAt: this.now().toISOString(),
    }
    if (isActive(current) && !isActive(next)) await this.guardLastActive(current)
    await this.users.updateUser(next)
    if (next.disabled && !current.disabled) await this.users.deleteSessionsOf(id)
    else if (patch.password !== undefined) {
      // An admin resetting their own password keeps the session they did it from (like changeOwnPassword).
      if (opts.keepSessionId) await this.users.deleteOtherSessions(id, opts.keepSessionId)
      else await this.users.deleteSessionsOf(id)
    }
    const changed = [
      patch.displayName !== undefined && 'displayName',
      patch.password !== undefined && 'password',
      patch.disabled !== undefined && 'disabled',
    ].filter(Boolean)
    await safeRecord(this.audit, { actor, action: 'user.update', target: current.username, details: { changed } })
    return toPublicUser(next)
  }

  async remove(id: string, actor: string): Promise<void> {
    this.assertManaged()
    const user = await this.load(id)
    await this.guardLastActive(user)
    await this.users.deleteUser(id)
    await safeRecord(this.audit, { actor, action: 'user.delete', target: user.username })
  }

  async changeOwnPassword(userId: string, current: string, next: string, keepSessionId?: string): Promise<void> {
    this.assertManaged()
    const user = await this.load(userId)
    if (!(await verifyPassword(String(current ?? ''), user.passwordHash))) throw new ValidationError('Current password is incorrect')
    checkPassword(next)
    await this.users.updateUser({ ...user, passwordHash: await this.hash(next), updatedAt: this.now().toISOString() })
    if (keepSessionId) await this.users.deleteOtherSessions(userId, keepSessionId)
    else await this.users.deleteSessionsOf(userId)
    await safeRecord(this.audit, { actor: user.username, action: 'user.password', target: user.username })
  }
}
