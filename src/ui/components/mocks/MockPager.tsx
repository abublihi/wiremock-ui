import { useState } from 'react'
import { ChevronLeftIcon, ChevronRightIcon } from 'lucide-react'
import { Button } from '@/ui/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/ui/components/ui/select'
import { useT } from '@/ui/i18n'

export const PAGE_SIZES = [25, 50, 100] as const
export const DEFAULT_PAGE_SIZE = 50
const STORAGE_KEY = 'wmui.mocks.pageSize'

function readPageSize(): number {
  try {
    const stored = Number(globalThis.localStorage?.getItem(STORAGE_KEY))
    return (PAGE_SIZES as readonly number[]).includes(stored) ? stored : DEFAULT_PAGE_SIZE
  } catch {
    return DEFAULT_PAGE_SIZE
  }
}

/** The mocks list's page size, remembered per browser (storage may be unavailable: then 50, not remembered). */
export function usePageSize(): [number, (size: number) => void] {
  // Read once on mount; the server render has no storage, but it only renders the skeleton, not the pager.
  const [size, setSize] = useState(readPageSize)
  const remember = (next: number) => {
    setSize(next)
    try {
      localStorage.setItem(STORAGE_KEY, String(next))
    } catch {}
  }
  return [size, remember]
}

const fmt = (n: number) => n.toLocaleString('en')

/**
 * "Showing 1–50 of 1,000", Previous / Next and the page size. `total` counts rows: a mock is one row, a scenario
 * (all its mocks) is one row, so when they differ the copy says so.
 */
export function MockPager({
  page,
  size,
  total,
  totalMocks,
  onPage,
  onSize,
}: {
  page: number
  size: number
  total: number
  totalMocks: number
  onPage: (page: number) => void
  onSize: (size: number) => void
}) {
  const t = useT()
  const pages = Math.max(1, Math.ceil(total / size))
  const from = total === 0 ? 0 : (page - 1) * size + 1
  const to = Math.min(total, page * size)
  const vars = { from: fmt(from), to: fmt(to), total: fmt(total), mocks: fmt(totalMocks) }
  return (
    <nav aria-label={t('pager.label')} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 text-xs">
      <p aria-live="polite" className="text-muted-foreground">
        {t(total === totalMocks ? 'pager.showing' : 'pager.showingRows', vars)}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-2 text-muted-foreground">
          <span>{t('pager.size')}</span>
          <Select value={String(size)} onValueChange={(v) => onSize(Number(v))}>
            <SelectTrigger size="sm" className="w-20" aria-label={t('pager.size')}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PAGE_SIZES.map((n) => (
                <SelectItem key={n} value={String(n)}>
                  {n}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>
        <span className="text-muted-foreground tabular-nums">{t('pager.page', { page: fmt(page), pages: fmt(pages) })}</span>
        <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => onPage(page - 1)}>
          <ChevronLeftIcon data-icon="inline-start" />
          {t('pager.previous')}
        </Button>
        <Button variant="outline" size="sm" disabled={page >= pages} onClick={() => onPage(page + 1)}>
          {t('pager.next')}
          <ChevronRightIcon data-icon="inline-end" />
        </Button>
      </div>
    </nav>
  )
}
