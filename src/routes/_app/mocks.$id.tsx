import { createFileRoute } from '@tanstack/react-router'
import { EditMockPage } from '@/ui/components/editor/EditMockPage'

export const Route = createFileRoute('/_app/mocks/$id')({
  component: EditMockRoute,
})

function EditMockRoute() {
  const { id } = Route.useParams()
  // Keyed by id: another mock starts a fresh editor (and a fresh "opened" version).
  return <EditMockPage key={id} id={id} />
}
