import { createFileRoute } from '@tanstack/react-router'
import { EndpointPage } from '@/ui/components/catalog/EndpointPage'

export const Route = createFileRoute('/_app/catalog/$key/endpoints/new')({ component: NewEndpointRoute })

function NewEndpointRoute() {
  const { key } = Route.useParams()
  return <EndpointPage key={key} integrationKey={key} />
}
