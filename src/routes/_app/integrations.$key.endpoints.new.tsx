import { createFileRoute } from '@tanstack/react-router'
import { EndpointPage, type EndpointPageSearch } from '@/ui/components/catalog/EndpointPage'

const str = (v: unknown) => (typeof v === 'string' && v !== '' ? v : undefined)

export const Route = createFileRoute('/_app/integrations/$key/endpoints/new')({
  // `next=mock`: added from the new-mock page; saving goes back there with the new endpoint picked (and the scenario
  // the mock was being added to, if any).
  validateSearch: (raw: Record<string, unknown>): EndpointPageSearch =>
    raw.next === 'mock'
      ? Object.fromEntries(
          Object.entries({ next: 'mock', scenario: str(raw.scenario), state: str(raw.state), after: str(raw.after) }).filter(([, v]) => v !== undefined),
        )
      : {},
  component: NewEndpointRoute,
})

function NewEndpointRoute() {
  const { key } = Route.useParams()
  const { next, ...scenario } = Route.useSearch()
  return <EndpointPage key={key} integrationKey={key} next={next} scenario={scenario} />
}
