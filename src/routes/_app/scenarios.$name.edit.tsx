import { createFileRoute } from '@tanstack/react-router'
import { ScenarioBuilder } from '@/ui/components/scenarios/ScenarioBuilder'

export const Route = createFileRoute('/_app/scenarios/$name/edit')({
  component: EditScenarioRoute,
})

function EditScenarioRoute() {
  const { name } = Route.useParams()
  // Keyed by name: another scenario starts a fresh form.
  return <ScenarioBuilder key={name} editName={name} />
}
