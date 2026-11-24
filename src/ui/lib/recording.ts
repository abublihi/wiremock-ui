import type { ReviewItem } from '@/server/recording/types'
import { firstSegment } from './import-review'

/** What a review row will be accepted as: its name (empty: the recorded one) and its tags. */
export type RowChoice = { name: string; tags: string[] }

/** The tag a recorded request suggests: the first part of its path (`/blog/posts` → `blog`), as on import. */
export function suggestTags(item: Pick<ReviewItem, 'url'>): string[] {
  const tag = firstSegment(item.url)
  return tag ? [tag] : []
}

export type AcceptItem = { id: string; name?: string; tags?: string[] }

/** The accept request's items, in the order shown. */
export function acceptPayload(rows: (RowChoice & { item: ReviewItem })[]): AcceptItem[] {
  return rows.map(({ item, name, tags }) => ({
    id: item.id,
    ...(name.trim() ? { name: name.trim() } : {}),
    ...(tags.length > 0 ? { tags } : {}),
  }))
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

/** Review rows as the list shows them: a plain row alone, or every row of one recorded scenario together. */
export type ReviewGroup = { scenario?: string; items: ReviewItem[] }

const scenarioOf = (item: ReviewItem) => (typeof item.stub.scenarioName === 'string' ? item.stub.scenarioName : undefined)

/**
 * Groups the rows of each recorded scenario ("Same request · N answers in order") where its first row stands, its rows
 * ordered by the state chain (Started → its new state → …); rows off the chain follow in list order.
 */
export function groupReviewItems(items: ReviewItem[]): ReviewGroup[] {
  const groups: ReviewGroup[] = []
  const byScenario = new Map<string, ReviewGroup>()
  for (const item of items) {
    const scenario = scenarioOf(item)
    if (scenario === undefined) {
      groups.push({ items: [item] })
      continue
    }
    const group = byScenario.get(scenario)
    if (group) group.items.push(item)
    else {
      const fresh = { scenario, items: [item] }
      byScenario.set(scenario, fresh)
      groups.push(fresh)
    }
  }
  for (const group of byScenario.values()) group.items = chainOrder(group.items)
  return groups
}

function chainOrder(items: ReviewItem[]): ReviewItem[] {
  const ordered: ReviewItem[] = []
  const left = new Set(items)
  let state: unknown = 'Started'
  for (;;) {
    const next = [...left].find((i) => i.stub.requiredScenarioState === state)
    if (!next) break
    ordered.push(next)
    left.delete(next)
    state = next.stub.newScenarioState
    if (typeof state !== 'string') break
  }
  return [...ordered, ...items.filter((i) => left.has(i))]
}
