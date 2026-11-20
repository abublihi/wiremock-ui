import { createFileRoute, redirect } from '@tanstack/react-router'
import { integrationsHref } from '@/ui/lib/legacy-routes'

// "Catalog" is now "Integrations": /catalog/nic/endpoints/new → /integrations/nic/endpoints/new, search kept.
export const Route = createFileRoute('/catalog/$')({
  beforeLoad: ({ params, location }) => {
    throw redirect({ href: integrationsHref(params._splat, location.searchStr, location.hash), statusCode: 301 })
  },
})
