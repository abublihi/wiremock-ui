import { createFileRoute } from '@tanstack/react-router'
import { EndpointPage, type EndpointPageSearch } from '@/ui/components/catalog/EndpointPage'

export const Route = createFileRoute('/_app/integrations/$key/endpoints/new')({
  // `next=mock`: added from the new-mock page; saving goes back there with the new endpoint picked.
  validateSearch: (raw: Record<string, unknown>): EndpointPageSearch => (raw.next === 'mock' ? { next: 'mock' } : {}),
  component: NewEndpointRoute,
})

function NewEndpointRoute() {
  const { key } = Route.useParams()
  const { next } = Route.useSearch()
  return <EndpointPage key={key} integrationKey={key} next={next} />
}
