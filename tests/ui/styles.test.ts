import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const css = readFileSync(path.resolve(__dirname, '../../src/ui/styles.css'), 'utf8')

/** The body of every `@media (prefers-reduced-motion: reduce) { … }` block, braces balanced. */
function reducedMotionBlocks(source: string): string {
  let out = ''
  const marker = '@media (prefers-reduced-motion: reduce)'
  for (let at = source.indexOf(marker); at !== -1; at = source.indexOf(marker, at + 1)) {
    let i = source.indexOf('{', at) + 1
    let depth = 1
    const start = i
    while (depth > 0 && i < source.length) {
      if (source[i] === '{') depth++
      else if (source[i] === '}') depth--
      i++
    }
    out += source.slice(start, i - 1)
  }
  return out
}

describe('styles.css', () => {
  it('defines the visual-direction tokens (dark default on :root)', () => {
    expect(css).toMatch(/--canvas:\s*#070b14/i)
    expect(css).toMatch(/--signal:\s*#00cc92/i)
    expect(css).toMatch(/--canvas:\s*#f4f7fa/i)
    expect(css).toMatch(/--radius:\s*6px/)
  })

  it('switches off every new animation under prefers-reduced-motion', () => {
    const block = reducedMotionBlocks(css)
    for (const cls of ['.cursor-blink', '.fade-up', '.sidebar-enter', '.stagger-children', '.status-pulse', '.live-flash']) {
      expect(block, cls).toContain(cls)
    }
    expect(block).toMatch(/animation:\s*none/)
  })

  it('keeps the hatch for the signature only: the hazard strip and the No match stamp', () => {
    const root = path.resolve(__dirname, '../../src')
    const users = (readdirSync(root, { recursive: true }) as string[])
      .filter((file) => file.endsWith('.tsx') && /\bhatch\b/.test(readFileSync(path.join(root, file), 'utf8').replace(/\/\/.*|\/\*[\s\S]*?\*\//g, '')))
      .map((file) => path.basename(file))
      .sort()
    expect(users).toEqual(['HazardStrip.tsx', 'NoMatchStamp.tsx'])
  })
})
