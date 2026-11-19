import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = join(import.meta.dirname, '../..')

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return path.endsWith(join('src', 'routes', 'api')) ? [] : files(path)
    return /\.(tsx?|css)$/.test(name) ? [path] : []
  })
}

// The plan's pattern `\b(ml|mr|pl|pr|left|right)-|text-(left|right)\b`, anchored to the start of a
// class token (after whitespace, a quote, a backtick or a variant `:`) so names such as
// `slide-in-from-right-2` (Radix's physical-side animations) are not mistaken for positioning.
const PHYSICAL = /(?<=^|[\s"'`:])-?(?:(?:ml|mr|pl|pr|left|right)-|text-(?:left|right)\b)/m

describe('logical direction classes', () => {
  it('no physical direction classes in src/ui or src/routes (except src/routes/api)', () => {
    const offenders: string[] = []
    for (const file of [...files(join(root, 'src/ui')), ...files(join(root, 'src/routes'))]) {
      readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
        const m = PHYSICAL.exec(line)
        if (m) offenders.push(`${relative(root, file)}:${i + 1}: ${m[0]}`)
      })
    }
    expect(offenders).toEqual([])
  })

  it('the pattern catches physical classes', () => {
    for (const cls of ['ml-2', 'pr-4', 'left-0', 'right-3', 'text-left', 'md:mr-1', '-ml-px', 'x text-right'])
      expect(PHYSICAL.test(cls), cls).toBe(true)
    for (const cls of ['ms-2', 'pe-4', 'start-0', 'text-start', 'slide-in-from-right-2', 'data-[side=left]:x'])
      expect(PHYSICAL.test(cls), cls).toBe(false)
  })
})
