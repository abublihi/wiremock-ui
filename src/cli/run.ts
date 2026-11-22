import { loadStoreSettings, type StoreSettings } from '../server/config'
import { AppError, ConflictError } from '../server/errors'
import { createStores, type Stores } from '../server/store'
import { UserService } from '../server/users/service'
import type { User } from '../server/users/types'

/**
 * `wiremock-ui`: account commands run from a shell on the server (in Docker: `docker exec -it <container> wiremock-ui …`).
 * It opens the same store as the server (STORE_DRIVER, REDIS_URL, SQLITE_PATH) and changes it directly, so it works
 * while the server runs and when nobody can sign in. Not over HTTP: having a shell on the server is the permission.
 */

/** Terminal input and output, replaceable in tests. */
export type Io = {
  out(text: string): void
  err(text: string): void
  /** stdin is a terminal, so the command can ask questions. */
  interactive: boolean
  ask(question: string): Promise<string>
  /** Asks without echoing what is typed. */
  askHidden(question: string): Promise<string>
  /** All of stdin (for --password-stdin). */
  readStdin(): Promise<string>
}

export type RunDeps = {
  openStores?: (settings: StoreSettings) => Stores
  /** bcrypt cost; tests lower it. */
  hashCost?: number
}

/** An error the command reports as one line and exits with `code` (1 = failed, 2 = wrong usage, 130 = cancelled). */
export class CliError extends Error {
  constructor(
    message: string,
    readonly code = 1,
  ) {
    super(message)
  }
}

/** Audit entries made by the command: a reserved name, so it never reads as a person. */
const ACTOR = 'system'
const STORE_TIMEOUT_MS = 5000

export const USAGE = `Usage: wiremock-ui <command> [options]

Commands:
  create-admin                Create an account (the first one, or another); asks for the username and password
    --username <name>         The username instead of asking
    --password-stdin          Read the password from stdin instead of asking (needs --username)
  reset-password <username>   Set a new password for an account; signs it out everywhere
    --password-stdin          Read the password from stdin instead of asking
    --enable                  Also enable the account if it is disabled
  list-users                  List the accounts
  help                        Show this help

It uses the server's own settings (STORE_DRIVER, REDIS_URL, SQLITE_PATH) and works while the server runs.
In Docker: docker exec -it <container> wiremock-ui create-admin`

type Command = { name: string; flags: Set<string>; values: Map<string, string>; positional: string[] }

const OPTIONS: Record<string, { flags: string[]; values: string[]; positional: number }> = {
  'create-admin': { flags: ['password-stdin'], values: ['username'], positional: 0 },
  'reset-password': { flags: ['password-stdin', 'enable'], values: [], positional: 1 },
  'list-users': { flags: [], values: [], positional: 0 },
}

function parse(argv: string[]): Command | 'help' {
  const [name, ...rest] = argv
  if (name === undefined || name === 'help' || name === '--help' || name === '-h') return 'help'
  const spec = OPTIONS[name]
  if (!spec) throw new CliError(`Unknown command "${name}". Run "wiremock-ui help" for the list.`, 2)
  const command: Command = { name, flags: new Set(), values: new Map(), positional: [] }
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i]!
    if (arg === '--help' || arg === '-h') return 'help'
    if (!arg.startsWith('--')) {
      command.positional.push(arg)
      continue
    }
    const eq = arg.indexOf('=')
    const key = arg.slice(2, eq === -1 ? undefined : eq)
    if (spec.values.includes(key)) {
      const value = eq === -1 ? rest[++i] : arg.slice(eq + 1)
      if (value === undefined || value === '') throw new CliError(`--${key} needs a value`, 2)
      command.values.set(key, value)
    } else if (spec.flags.includes(key) && eq === -1) {
      command.flags.add(key)
    } else {
      throw new CliError(`Unknown option "${arg}" for ${name}. Run "wiremock-ui help".`, 2)
    }
  }
  if (command.positional.length > spec.positional) {
    throw new CliError(`Too many arguments for ${name}. Run "wiremock-ui help".`, 2)
  }
  return command
}

async function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined
  try {
    return await Promise.race([promise, new Promise<never>((_, reject) => (timer = setTimeout(() => reject(new CliError(message)), ms)))])
  } finally {
    clearTimeout(timer)
  }
}

async function openStore(env: Record<string, string | undefined>, deps: RunDeps): Promise<Stores> {
  const settings = loadStoreSettings(env)
  if (settings.storeDriver === 'none') {
    throw new CliError(
      'WireMock-only mode (STORE_DRIVER=none) keeps accounts in memory, so this command cannot change them. Set ADMIN_USER / ADMIN_PASSWORD and restart instead.',
    )
  }
  const where = settings.storeDriver === 'redis' ? 'Redis (REDIS_URL)' : `SQLite at ${settings.sqlitePath}`
  const stores = (deps.openStores ?? createStores)(settings)
  const reachable = await withTimeout(stores.ping().catch(() => false), STORE_TIMEOUT_MS, `Cannot reach the store: ${where}`)
  if (!reachable) {
    void stores.close().catch(() => {})
    throw new CliError(`Cannot reach the store: ${where}`)
  }
  return stores
}

async function readPassword(command: Command, io: Io): Promise<string> {
  if (command.flags.has('password-stdin')) {
    const password = (await io.readStdin()).split(/\r?\n/)[0] ?? ''
    if (password === '') throw new CliError('No password on stdin', 2)
    return password
  }
  if (!io.interactive) {
    throw new CliError('No terminal to ask for the password: run it with "docker exec -it", or pass --password-stdin', 2)
  }
  const password = await io.askHidden('Password (8–72 characters): ')
  if ((await io.askHidden('Repeat the password: ')) !== password) throw new CliError('The passwords do not match')
  return password
}

async function createAdmin(command: Command, stores: Stores, users: UserService, io: Io): Promise<void> {
  let username = command.values.get('username')
  if (username === undefined) {
    if (command.flags.has('password-stdin') || !io.interactive) {
      throw new CliError('Pass --username <name> (there is no terminal to ask for it)', 2)
    }
    username = (await io.ask('Username: ')).trim()
    if (username === '') throw new CliError('No username given', 2)
  }
  if (await stores.users.getUserByName(username)) throw taken(username)
  const password = await readPassword(command, io)
  const first = (await stores.users.countUsers()) === 0
  try {
    const user = await users.create({ username, password }, ACTOR)
    io.out(`Created the account "${user.username}"${first ? ' (the first one)' : ''}. Sign in with it in the browser.`)
  } catch (err) {
    if (err instanceof ConflictError) throw taken(username)
    throw err
  }
}

const taken = (username: string) =>
  new CliError(`An account named "${username.toLowerCase()}" already exists. To set its password: wiremock-ui reset-password ${username.toLowerCase()}`)

async function resetPassword(command: Command, stores: Stores, users: UserService, io: Io): Promise<void> {
  const username = command.positional[0]
  if (username === undefined) throw new CliError('Usage: wiremock-ui reset-password <username>', 2)
  const user = await stores.users.getUserByName(username)
  if (!user) {
    const names = (await stores.users.listUsers()).map((u) => u.username)
    throw new CliError(`No account named "${username}". ${names.length ? `Accounts: ${names.join(', ')}` : 'There are no accounts yet: wiremock-ui create-admin'}`)
  }
  const password = await readPassword(command, io)
  const enable = command.flags.has('enable') && user.disabled
  await users.update(user.id, { password, ...(enable ? { disabled: false } : {}) }, ACTOR)
  io.out(`Changed the password of "${user.username}"${enable ? ' and enabled it' : ''}; it was signed out everywhere.`)
  if (user.disabled && !enable) io.out('This account is disabled: add --enable to enable it, or enable it on the Users page.')
}

function listUsers(accounts: User[], io: Io): void {
  if (accounts.length === 0) {
    io.out('No accounts yet. Create the first one: wiremock-ui create-admin')
    return
  }
  const width = Math.max(8, ...accounts.map((u) => u.username.length))
  io.out(`${'USERNAME'.padEnd(width)}  STATUS    CREATED`)
  for (const u of accounts) io.out(`${u.username.padEnd(width)}  ${(u.disabled ? 'disabled' : 'active').padEnd(8)}  ${u.createdAt.slice(0, 10)}`)
}

/** Runs one command; returns the exit code. Never throws. */
export async function run(argv: string[], env: Record<string, string | undefined>, io: Io, deps: RunDeps = {}): Promise<number> {
  let stores: Stores | undefined
  try {
    const command = parse(argv)
    if (command === 'help') {
      io.out(USAGE)
      return 0
    }
    stores = await openStore(env, deps)
    const users = new UserService({ users: stores.users, audit: stores.audit, hashCost: deps.hashCost })
    if (command.name === 'create-admin') await createAdmin(command, stores, users, io)
    else if (command.name === 'reset-password') await resetPassword(command, stores, users, io)
    else listUsers(await stores.users.listUsers(), io)
    return 0
  } catch (err) {
    if (err instanceof CliError) {
      io.err(err.message)
      return err.code
    }
    if (err instanceof AppError) {
      io.err(err.message)
      return 1
    }
    io.err(`Failed: ${(err as Error).message}`)
    return 1
  } finally {
    if (stores) await withTimeout(stores.close(), STORE_TIMEOUT_MS, 'close timed out').catch(() => {})
  }
}
