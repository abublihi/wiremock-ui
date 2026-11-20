import { createContext, useContext, type ReactNode } from 'react'
import type { ServerConfig } from '@/ui/api/queries'

const ServerConfigContext = createContext<ServerConfig | null>(null)

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
