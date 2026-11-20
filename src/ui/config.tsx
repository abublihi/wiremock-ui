import { createContext, useContext, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { type ServerConfig, serverConfigQueryOptions } from '@/ui/api/queries'

// undefined: no provider (a component rendered on its own); null: the layout could not load the config.
const ServerConfigContext = createContext<ServerConfig | null | undefined>(undefined)

/** Hands the server's configuration (loaded once by the signed-in layout) to every page below it. */
export function ServerConfigProvider({ config, children }: { config: ServerConfig | null; children: ReactNode }) {
  return <ServerConfigContext.Provider value={config}>{children}</ServerConfigContext.Provider>
}

/**
 * True in WireMock-only mode (STORE_DRIVER=none, spec A10): no accounts to manage, no history, no owner
 * filter. False when unknown, so the UI defaults to the stored behaviour.
 */
export function useWireMockOnly(): boolean {
  return useContext(ServerConfigContext)?.storeDriver === 'none'
}

/**
 * WireMock's stub URL as clients reach it (WIREMOCK_PUBLIC_URL), for curl commands. Read from the layout's
 * config; fetched here only when the layout could not load it (never without a provider). Undefined until known.
 */
export function useWiremockPublicUrl(): string | undefined {
  const config = useContext(ServerConfigContext)
  const fetched = useQuery({ ...serverConfigQueryOptions(), enabled: config === null })
  return config?.wiremockPublicUrl ?? fetched.data?.wiremockPublicUrl
}
