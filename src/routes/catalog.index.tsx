import { createFileRoute, redirect } from '@tanstack/react-router'
import { integrationsHref } from '@/ui/lib/legacy-routes'

// "Catalog" is now "Integrations": old links and bookmarks keep working.
export const Route = createFileRoute('/catalog/')({
  beforeLoad: ({ location }) => {
    throw redirect({ href: integrationsHref('', location.searchStr, location.hash), statusCode: 301 })
  },
})
