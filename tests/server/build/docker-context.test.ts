import { readFileSync, readdirSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * The Docker build context (.dockerignore) must carry what `npm run build` reads: the in-app Guide is built from
 * docs/guide/*.md, so an image built without them ships an empty Guide. Docker's rule: the last matching pattern
 * wins, `!` re-includes, and a pattern matches a path or anything under it.
 */
const root = join(import.meta.dirname, '../../..')
const patterns = readFileSync(join(root, '.dockerignore'), 'utf8')
  .split('\n')
  .map((l) => l.trim())
  .filter((l) => l !== '' && !l.startsWith('#'))

const globToRegExp = (glob: string) =>
  new RegExp(
    '^' +
      glob
        .replace(/[.+^${}()|[\]\\]/g, '\\$&')
        .replace(/\*\*/g, '\0')
        .replace(/\*/g, '[^/]*')
        .replace(/\0/g, '.*') +
      '(/.*)?$',
  )

function excluded(path: string): boolean {
  let out = false
  for (const raw of patterns) {
    const negate = raw.startsWith('!')
    const glob = negate ? raw.slice(1) : raw
    if (globToRegExp(glob).test(path)) out = !negate
  }
  return out
}

describe('Docker build context', () => {
  it('includes every guide page the Guide is built from', () => {
    const guide = readdirSync(join(root, 'docs/guide')).filter((f) => f.endsWith('.md'))
    expect(guide.length).toBeGreaterThan(5)
    for (const file of guide) expect(excluded(relative(root, join(root, 'docs/guide', file))), file).toBe(false)
  })

  it('includes the sources, examples and server entry and leaves the rest of docs out', () => {
    for (const path of ['src/ui/lib/guide.ts', 'examples/seed.json', 'server.mjs', 'package.json', 'vite.config.ts']) {
      expect(excluded(path), path).toBe(false)
    }
    for (const path of ['docs/INSTALL.md', 'docs/screenshots/mocks.png', 'node_modules/react/index.js', 'tests/ui/setup.ts', '.env']) {
      expect(excluded(path), path).toBe(true)
    }
  })
})
