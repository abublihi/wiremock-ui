import { createFileRoute } from '@tanstack/react-router'
import { EditMockPage } from '@/ui/components/editor/EditMockPage'

/**
 * `add`: for a mock with several responses, open with a new response for these values, one per condition, null for
 * any ("Add a response for 7"). One value may come as a plain string (older links).
 */
export type EditMockSearch = { add?: (string | null)[] }

const value = (v: unknown) => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : null)

export const Route = createFileRoute('/_app/mocks/$id')({
  validateSearch: (raw: Record<string, unknown>): EditMockSearch => {
    const add = Array.isArray(raw.add) ? raw.add.map(value) : raw.add !== undefined && raw.add !== '' ? [value(raw.add)] : undefined
    return { add: add && add.some((v) => v !== null && v !== '') ? add : undefined }
  },
  component: EditMockRoute,
})

function EditMockRoute() {
  const { id } = Route.useParams()
  const { add } = Route.useSearch()
  // Keyed by id: another mock starts a fresh editor (and a fresh "opened" version).
  return <EditMockPage key={id} id={id} addValues={add} />
}
