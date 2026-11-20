import { createFileRoute } from '@tanstack/react-router'
import { EndpointPage } from '@/ui/components/catalog/EndpointPage'

export const Route = createFileRoute('/_app/integrations/$key/endpoints/$endpoint/edit')({ component: EditEndpointRoute })

function EditEndpointRoute() {
  const { key, endpoint } = Route.useParams()
  // Keyed: another endpoint starts a fresh form.
  return <EndpointPage key={`${key}/${endpoint}`} integrationKey={key} endpointKey={endpoint} />
}
