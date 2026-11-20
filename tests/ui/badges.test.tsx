import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MethodBadge } from '@/ui/components/common/MethodBadge'
import { StatusBadge } from '@/ui/components/common/StatusBadge'
import { LiveDot } from '@/ui/components/common/LiveDot'

describe('MethodBadge', () => {
  it.each([
    ['GET', 'emerald'],
    ['POST', 'blue'],
    ['PUT', 'amber'],
    ['PATCH', 'purple'],
    ['DELETE', 'red'],
  ])('%s is tinted %s', (method, colour) => {
    render(<MethodBadge method={method} />)
    const badge = screen.getByText(method)
    expect(badge.className).toContain(`text-${colour}-`)
    expect(badge.className).toContain(`bg-${colour}-500/15`)
  })

  it('matches the method case-insensitively and shows it upper-case', () => {
    render(<MethodBadge method="get" />)
    expect(screen.getByText('GET').className).toContain('text-emerald-')
  })

  it.each(['OPTIONS', 'HEAD', 'ANY'])('%s is muted', (method) => {
    render(<MethodBadge method={method} />)
    const cls = screen.getByText(method).className
    expect(cls).toContain('text-muted-foreground')
    expect(cls).not.toMatch(/emerald|blue|amber|purple|red/)
  })
})

describe('StatusBadge', () => {
  it.each([
    [200, 'signal'],
    [204, 'signal'],
    [302, 'blue'],
    [404, 'hazard'],
    [499, 'hazard'],
    [500, 'mismatch'],
    [503, 'mismatch'],
  ])('%i is %s', (status, colour) => {
    render(<StatusBadge status={status} />)
    expect(screen.getByText(String(status)).className).toContain(`text-${colour}`)
  })

  it('anything else is muted', () => {
    render(<StatusBadge status={101} />)
    expect(screen.getByText('101').className).toContain('text-muted-foreground')
  })
})

describe('LiveDot', () => {
  it('is a pulsing signal dot with an accessible label', () => {
    render(<LiveDot label="Live" />)
    const status = screen.getByRole('status')
    expect(status.textContent).toContain('Live')
    const dot = status.querySelector('[aria-hidden]')
    expect(dot?.className).toContain('status-pulse')
    expect(dot?.className).toContain('bg-signal')
  })
})
