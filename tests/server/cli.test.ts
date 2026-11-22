import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { run, type Io } from '../../src/cli/run'
import { createStores } from '../../src/server/store'
import { verifyPassword } from '../../src/server/users/passwords'

let dir: string
let env: Record<string, string>

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'wmui-cli-'))
  env = { SQLITE_PATH: join(dir, 'ui.db') }
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

/** A scripted terminal: `answers` are typed in order (ask and askHidden alike); `stdin` is what is piped in. */
function fakeIo(opts: { answers?: string[]; stdin?: string; interactive?: boolean } = {}) {
  const answers = [...(opts.answers ?? [])]
  const out: string[] = []
  const err: string[] = []
  const asked: string[] = []
  const next = async (q: string) => {
    asked.push(q)
    const a = answers.shift()
    if (a === undefined) throw new Error(`unexpected question: ${q}`)
    return a
  }
  const io: Io = {
    out: (t) => void out.push(t),
    err: (t) => void err.push(t),
    interactive: opts.interactive ?? opts.stdin === undefined,
    ask: next,
    askHidden: next,
    readStdin: async () => opts.stdin ?? '',
  }
  return { io, out, err, asked }
}

const cli = (argv: string[], io: Io) => run(argv, env, io, { hashCost: 4 })

async function users() {
  const stores = createStores({ storeDriver: 'sqlite', sqlitePath: env.SQLITE_PATH! })
  try {
    return await stores.users.listUsers()
  } finally {
    await stores.close()
  }
}

describe('create-admin', () => {
  test('asks for the username and the password twice, then makes the account (the first one)', async () => {
    const t = fakeIo({ answers: ['Sara', 'secret-pass-1', 'secret-pass-1'] })
    expect(await cli(['create-admin'], t.io)).toBe(0)
    expect(t.asked).toEqual(['Username: ', 'Password (8–72 characters): ', 'Repeat the password: '])
    expect(t.out).toEqual(['Created the account "sara" (the first one). Sign in with it in the browser.'])
    const [user] = await users()
    expect(user).toMatchObject({ username: 'sara', disabled: false, role: 'admin' })
    expect(await verifyPassword('secret-pass-1', user!.passwordHash)).toBe(true)
  })

  test('--username and --password-stdin make it without a terminal (first line of stdin)', async () => {
    const t = fakeIo({ stdin: 'piped-pass-1\nignored\n' })
    expect(await cli(['create-admin', '--username=ops', '--password-stdin'], t.io)).toBe(0)
    const [user] = await users()
    expect(await verifyPassword('piped-pass-1', user!.passwordHash)).toBe(true)
  })

  test('refuses a name that exists before asking for a password, and points to reset-password', async () => {
    await cli(['create-admin', '--username', 'sara', '--password-stdin'], fakeIo({ stdin: 'secret-pass-1' }).io)
    const t = fakeIo({ answers: [] })
    expect(await cli(['create-admin', '--username', 'SARA'], t.io)).toBe(1)
    expect(t.err).toEqual(['An account named "sara" already exists. To set its password: wiremock-ui reset-password sara'])
    expect(t.asked).toEqual([])
  })

  test('mismatched passwords, a short password and a reserved name make nothing', async () => {
    const mismatch = fakeIo({ answers: ['sara', 'secret-pass-1', 'secret-pass-2'] })
    expect(await cli(['create-admin'], mismatch.io)).toBe(1)
    expect(mismatch.err).toEqual(['The passwords do not match'])
    const short = fakeIo({ answers: ['sara', 'short', 'short'] })
    expect(await cli(['create-admin'], short.io)).toBe(1)
    expect(short.err).toEqual(['password must be 8–72 characters'])
    const reserved = fakeIo({ stdin: 'secret-pass-1' })
    expect(await cli(['create-admin', '--username', 'wiremock', '--password-stdin'], reserved.io)).toBe(1)
    expect(reserved.err).toEqual(['username "wiremock" is reserved'])
    expect(await users()).toEqual([])
  })

  test('without a terminal it says how to run it instead of hanging', async () => {
    const noName = fakeIo({ interactive: false })
    expect(await cli(['create-admin'], noName.io)).toBe(2)
    expect(noName.err).toEqual(['Pass --username <name> (there is no terminal to ask for it)'])
    const noPassword = fakeIo({ interactive: false })
    expect(await cli(['create-admin', '--username', 'sara'], noPassword.io)).toBe(2)
    expect(noPassword.err).toEqual(['No terminal to ask for the password: run it with "docker exec -it", or pass --password-stdin'])
    const empty = fakeIo({ stdin: '\n' })
    expect(await cli(['create-admin', '--username', 'sara', '--password-stdin'], empty.io)).toBe(2)
    expect(empty.err).toEqual(['No password on stdin'])
  })
})

describe('reset-password', () => {
  beforeEach(async () => {
    expect(await cli(['create-admin', '--username', 'sara', '--password-stdin'], fakeIo({ stdin: 'old-password-1' }).io)).toBe(0)
  })

  test('sets the new password and signs the account out everywhere', async () => {
    const stores = createStores({ storeDriver: 'sqlite', sqlitePath: env.SQLITE_PATH! })
    const [sara] = await stores.users.listUsers()
    const session = await stores.users.createSession(sara!.id, 3600)
    const t = fakeIo({ answers: ['new-password-2', 'new-password-2'] })
    expect(await cli(['reset-password', 'Sara'], t.io)).toBe(0)
    expect(t.out).toEqual(['Changed the password of "sara"; it was signed out everywhere.'])
    const [after] = await stores.users.listUsers()
    expect(await verifyPassword('new-password-2', after!.passwordHash)).toBe(true)
    expect(await stores.users.getSession(session.id)).toBeNull()
    await stores.close()
  })

  test('a disabled account stays disabled unless --enable', async () => {
    const stores = createStores({ storeDriver: 'sqlite', sqlitePath: env.SQLITE_PATH! })
    const [sara] = await stores.users.listUsers()
    await stores.users.updateUser({ ...sara!, disabled: true })
    await stores.close()

    const keep = fakeIo({ stdin: 'new-password-2' })
    expect(await cli(['reset-password', 'sara', '--password-stdin'], keep.io)).toBe(0)
    expect(keep.out[1]).toBe('This account is disabled: add --enable to enable it, or enable it on the Users page.')
    expect((await users())[0]!.disabled).toBe(true)

    const enable = fakeIo({ stdin: 'new-password-3' })
    expect(await cli(['reset-password', 'sara', '--password-stdin', '--enable'], enable.io)).toBe(0)
    expect(enable.out).toEqual(['Changed the password of "sara" and enabled it; it was signed out everywhere.'])
    expect((await users())[0]!.disabled).toBe(false)
  })

  test('an unknown name lists the accounts there are; a missing name is a usage error', async () => {
    const unknown = fakeIo({ stdin: 'x' })
    expect(await cli(['reset-password', 'bob', '--password-stdin'], unknown.io)).toBe(1)
    expect(unknown.err).toEqual(['No account named "bob". Accounts: sara'])
    const missing = fakeIo()
    expect(await cli(['reset-password'], missing.io)).toBe(2)
    expect(missing.err).toEqual(['Usage: wiremock-ui reset-password <username>'])
  })
})

describe('list-users, help and mistakes', () => {
  test('list-users shows each account and its status; with none it says how to make one', async () => {
    const none = fakeIo()
    expect(await cli(['list-users'], none.io)).toBe(0)
    expect(none.out).toEqual(['No accounts yet. Create the first one: wiremock-ui create-admin'])
    await cli(['create-admin', '--username', 'sara', '--password-stdin'], fakeIo({ stdin: 'secret-pass-1' }).io)
    const listed = fakeIo()
    expect(await cli(['list-users'], listed.io)).toBe(0)
    expect(listed.out[0]).toBe('USERNAME  STATUS    CREATED')
    expect(listed.out[1]).toMatch(/^sara {6}active {4}\d{4}-\d{2}-\d{2}$/)
  })

  test('help (and no command) prints the usage; unknown commands and options are usage errors', async () => {
    for (const argv of [[], ['help'], ['--help'], ['create-admin', '--help']]) {
      const t = fakeIo()
      expect(await cli(argv, t.io)).toBe(0)
      expect(t.out[0]).toMatch(/^Usage: wiremock-ui <command>/)
    }
    const unknown = fakeIo()
    expect(await cli(['frob'], unknown.io)).toBe(2)
    expect(unknown.err).toEqual(['Unknown command "frob". Run "wiremock-ui help" for the list.'])
    const option = fakeIo()
    expect(await cli(['list-users', '--enable'], option.io)).toBe(2)
    expect(option.err).toEqual(['Unknown option "--enable" for list-users. Run "wiremock-ui help".'])
    const extra = fakeIo()
    expect(await cli(['create-admin', 'sara'], extra.io)).toBe(2)
    expect(await cli(['create-admin', '--username'], fakeIo().io)).toBe(2)
  })

  test('refuses WireMock-only mode (accounts in memory) and a bad store setting', async () => {
    const none = fakeIo()
    expect(await run(['list-users'], { STORE_DRIVER: 'none' }, none.io)).toBe(1)
    expect(none.err[0]).toMatch(/^WireMock-only mode \(STORE_DRIVER=none\) keeps accounts in memory/)
    const bad = fakeIo()
    expect(await run(['list-users'], { STORE_DRIVER: 'redis' }, bad.io)).toBe(1)
    expect(bad.err).toEqual(['Invalid configuration: REDIS_URL is required when STORE_DRIVER=redis'])
  })

  test('a store that does not answer is reported, and closed', async () => {
    let closed = false
    const t = fakeIo()
    const code = await run(['list-users'], { REDIS_URL: 'redis://nowhere:6379' }, t.io, {
      openStores: () => ({ ping: async () => false, close: async () => void (closed = true) }) as never,
    })
    expect(code).toBe(1)
    expect(t.err).toEqual(['Cannot reach the store: Redis (REDIS_URL)'])
    await new Promise((r) => setTimeout(r, 0))
    expect(closed).toBe(true)
  })
})
