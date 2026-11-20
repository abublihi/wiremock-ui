import { useCallback } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { NewMockPage, type NewMockSearch } from '@/ui/components/editor/NewMockPage'

const str = (v: unknown) => (typeof v === 'string' && v !== '' ? v : undefined)

export const Route = createFileRoute('/_app/mocks/new')({
  validateSearch: (raw: Record<string, unknown>): NewMockSearch => ({
    integration: str(raw.integration),
    endpoint: str(raw.endpoint),
    mode: raw.mode === 'json' ? 'json' : undefined,
    from: str(raw.from),
    scenario: str(raw.scenario),
    state: str(raw.state),
  }),
  component: NewMockRoute,
})

function NewMockRoute() {
  const search = Route.useSearch()
  const navigate = Route.useNavigate()
  const onSearchChange = useCallback((next: NewMockSearch) => void navigate({ search: next }), [navigate])
  return <NewMockPage search={search} onSearchChange={onSearchChange} />
}
