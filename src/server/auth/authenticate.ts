import { AppError } from '../errors'
import type { Config } from '../config'
import { verifyPasswordOrDummy } from '../users/passwords'
import { toPublicUser } from '../users/types'
import type { PublicUser, Session, UserStore } from '../users/types'
import { clientIp, limitLoginAttempts, readSessionCookie, safeEqual } from './session'

export type Principal = { user: PublicUser; via: 'session' | 'basic'; session?: Session }
export type AuthDeps = {
  users: UserStore
  config: Config
  /** Password check; injectable so tests can count verifications. */
  verify?: (plain: string, hash: string | undefined) => Promise<boolean>
}

const unauthenticated = () => new AppError('Authentication required', 401)

async function viaSession(request: Request, deps: AuthDeps): Promise<Principal | null> {
  const id = readSessionCookie(request, deps.config.sessionSecret)
  if (!id) return null
  const session = await deps.users.getSession(id)
  if (!session || Date.parse(session.expiresAt) <= Date.now()) return null
  const user = await deps.users.getUser(session.userId)
  if (!user || user.disabled) return null
  return { user: toPublicUser(user), via: 'session', session }
}

async function viaBasic(request: Request, deps: AuthDeps): Promise<Principal | null> {
  const header = request.headers.get('authorization')
  if (!header || !/^basic\s/i.test(header)) return null
  const verify = deps.verify ?? verifyPasswordOrDummy
  return limitLoginAttempts(deps.users, clientIp(request, deps.config), async () => {
    const decoded = Buffer.from(header.slice(6).trim(), 'base64').toString('utf8')
    const colon = decoded.indexOf(':')
    if (colon === -1) return null
    const user = await deps.users.getUserByName(decoded.slice(0, colon))
    const ok = await verify(decoded.slice(colon + 1), user?.passwordHash)
    if (!user || user.disabled || !ok) return null
    return { user: toPublicUser(user), via: 'basic' as const }
  })
}

export async function authenticate(request: Request, deps: AuthDeps): Promise<Principal> {
  const principal = (await viaSession(request, deps)) ?? (await viaBasic(request, deps))
  if (!principal) throw unauthenticated()
  return principal
}

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

export function assertCsrf(request: Request, principal: Principal): void {
  if (principal.via !== 'session' || !principal.session || SAFE_METHODS.has(request.method.toUpperCase())) return
  const token = request.headers.get('x-csrf-token')
  if (!token || !safeEqual(token, principal.session.csrfToken)) throw new AppError('CSRF token missing or invalid', 403)
}
