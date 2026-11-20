import { createFileRoute } from '@tanstack/react-router'
import { ScenarioBuilder } from '@/ui/components/scenarios/ScenarioBuilder'

export const Route = createFileRoute('/_app/scenarios/new')({
  component: ScenarioBuilder,
})
