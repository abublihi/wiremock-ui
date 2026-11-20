import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test } from 'vitest'
import { CONFIG_ENV_VARS } from '../../src/server/config'

// The README's "Environment variables" table is the configuration reference: it must name exactly the variables
// the server reads, so the docs cannot drift from the code.

const ROOT = join(import.meta.dirname, '../..')

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    return statSync(path).isDirectory() ? sourceFiles(path) : /\.(ts|tsx|mjs)$/.test(name) ? [path] : []
  })
}

/** `process.env.NAME` reads outside loadConfig (PORT, LOG_LEVEL). */
function directEnvReads(): string[] {
  const files = [...sourceFiles(join(ROOT, 'src')), join(ROOT, 'server.mjs')]
  const names = files.flatMap((f) => [...readFileSync(f, 'utf8').matchAll(/process\.env\.([A-Z][A-Z0-9_]*)/g)].map((m) => m[1]!))
  return [...new Set(names)]
}

/** First-column `NAME`s of the table under the README's "### Environment variables" heading. */
function readmeTable(): string[] {
  const readme = readFileSync(join(ROOT, 'README.md'), 'utf8')
  const start = readme.indexOf('### Environment variables')
  expect(start, 'README has an "### Environment variables" section').toBeGreaterThan(-1)
  const rest = readme.slice(start + 1)
  const section = rest.slice(0, rest.search(/\n#{2,3} /))
  return [...section.matchAll(/^\| `([A-Z][A-Z0-9_]*)` \|/gm)].map((m) => m[1]!)
}

test('the README configuration table lists every environment variable the server reads, and nothing else', () => {
  const code = [...new Set([...CONFIG_ENV_VARS, ...directEnvReads()])].sort()
  const documented = readmeTable()
  expect(new Set(documented).size, 'no variable is listed twice').toBe(documented.length)
  expect([...documented].sort()).toEqual(code)
})

test('CONFIG_ENV_VARS names the variables loadConfig reads', () => {
  expect(CONFIG_ENV_VARS).toContain('WIREMOCK_URL')
  expect(CONFIG_ENV_VARS).toContain('RECORDING_ALLOWED')
})
