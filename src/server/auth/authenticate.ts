import { AppError } from '../errors'
import type { Config } from '../config'
import { verifyPassword } from '../users/passwords'
import { toPublicUser } from '../users/types'
import type { PublicUser, Session, UserStore } from '../users/types'
import { LOGIN_MAX_ATTEMPTS, LOGIN_WINDOW_SECONDS, clientIp, readSessionCookie, safeEqual } from './session'

export type Principal = { user: PublicUser; via: 'session' | 'basic'; session?: Session }
export class AuthDeps {
  constructor(
    public users: UserStore,
    public config: Config,
  ) {}
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
  const hits = await deps.users.hitRateLimit(clientIp(request, deps.config), LOGIN_WINDOW_SECONDS)
  if (hits > LOGIN_MAX_ATTEMPTS) throw new AppError('Too many attempts, try again later', 429)
  const decoded = Buffer.from(header.slice(6).trim(), 'base64').toString('utf8')
  const colon = decoded.indexOf(':')
  if (colon === -1) return null
  const user = await deps.users.getUserByName(decoded.slice(0, colon))
  if (!user || user.disabled) return null
  if (!(await verifyPassword(decoded.slice(colon + 1), user.passwordHash))) return null
  return { user: toPublicUser(user), via: 'basic' }
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
  if (!token || !safeEqual(token, principal.session.csrfToken)) throw new AppError('Invalid CSRF token', 403)
}
