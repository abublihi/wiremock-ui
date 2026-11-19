import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/')({
  component: Home,
})

function Home() {
  return (
    <main>
      <div role="status">Test environment</div>
      <h1>wiremock-ui</h1>
    </main>
  )
}
