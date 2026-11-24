import { createFileRoute, redirect } from '@tanstack/react-router'

// Integrations (once called Catalog) are retired: mocks carry tags instead. Old links and bookmarks land on the mocks.
export const Route = createFileRoute('/integrations/')({
  beforeLoad: () => {
    throw redirect({ to: '/mocks', statusCode: 301 })
  },
})
