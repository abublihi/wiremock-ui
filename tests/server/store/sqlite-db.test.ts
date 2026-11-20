import { mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, test } from 'vitest'
import { SqliteDb } from '../../../src/server/store/sqlite/db'

const dirs: string[] = []
const scratch = () => {
  const dir = mkdtempSync(join(tmpdir(), 'wmui-db-'))
  dirs.push(dir)
  return dir
}
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

const mode = (path: string) => statSync(path).mode & 0o777

describe.skipIf(process.platform === 'win32')('SqliteDb file permissions', () => {
  test('creates the directory 0700 and the database file 0600', () => {
    const dir = join(scratch(), 'nested', 'data')
    const path = join(dir, 'wiremock-ui.db')
    const db = new SqliteDb(path)
    db.close()
    expect(mode(dir)).toBe(0o700)
    expect(mode(path)).toBe(0o600)
  })

  test('tightens an existing world-readable database file to 0600', () => {
    const path = join(scratch(), 'wiremock-ui.db')
    writeFileSync(path, '', { mode: 0o644 })
    expect(mode(path)).toBe(0o644)
    new SqliteDb(path).close()
    expect(mode(path)).toBe(0o600)
  })
})

describe('SqliteDb.tx', () => {
  const open = () => {
    const db = new SqliteDb(':memory:')
    db.db.exec('CREATE TABLE t (v TEXT)')
    return db
  }
  const count = (db: SqliteDb) => (db.db.prepare('SELECT COUNT(*) AS n FROM t').get() as { n: number }).n

  test('rolls back and rethrows the callback error', () => {
    const db = open()
    const boom = new Error('boom')
    expect(() =>
      db.tx(() => {
        db.db.exec("INSERT INTO t VALUES ('x')")
        throw boom
      }),
    ).toThrow(boom)
    expect(count(db)).toBe(0)
    db.close()
  })

  test('a failing ROLLBACK never masks the original error', () => {
    const db = open()
    const boom = new Error('original')
    expect(() =>
      db.tx(() => {
        db.db.exec('ROLLBACK') // the transaction is already gone, so tx's own ROLLBACK fails
        throw boom
      }),
    ).toThrow(boom)
    // Still usable afterwards.
    db.tx(() => db.db.exec("INSERT INTO t VALUES ('y')"))
    expect(count(db)).toBe(1)
    db.close()
  })

  test('refuses a callback that returns a thenable, and rolls back its synchronous work', () => {
    const db = open()
    expect(() =>
      db.tx(() => {
        db.db.exec("INSERT INTO t VALUES ('x')")
        return { then: () => undefined }
      }),
    ).toThrow(/must be synchronous/)
    expect(count(db)).toBe(0)
    db.close()
  })
})
