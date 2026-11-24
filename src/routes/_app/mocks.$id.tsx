import { createFileRoute } from '@tanstack/react-router'
import { EditMockPage } from '@/ui/components/editor/EditMockPage'

/** `add`: for a mock with several responses, open with a new response for this value ("Add a response for 7"). */
export type EditMockSearch = { add?: string }

export const Route = createFileRoute('/_app/mocks/$id')({
  validateSearch: (raw: Record<string, unknown>): EditMockSearch => ({
    add: typeof raw.add === 'string' && raw.add !== '' ? raw.add : typeof raw.add === 'number' ? String(raw.add) : undefined,
  }),
  component: EditMockRoute,
})

function EditMockRoute() {
  const { id } = Route.useParams()
  const { add } = Route.useSearch()
  // Keyed by id: another mock starts a fresh editor (and a fresh "opened" version).
  return <EditMockPage key={id} id={id} addValue={add} />
}
