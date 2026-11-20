// Values shared by the global setup and the specs. The app port is fixed so the config can
// read it before the setup runs; override it with E2E_UI_PORT when 3417 is taken.
export const E2E_UI_PORT = Number(process.env.E2E_UI_PORT ?? 3417)
export const E2E_UI_URL = `http://127.0.0.1:${E2E_UI_PORT}`

export const ADMIN = { username: 'admin', password: 'e2e-admin-password' }
export const USER_A = { username: 'qa-alice', password: 'alice-password-1' }
export const USER_B = { username: 'qa-bob', password: 'bob-password-1' }

/** Set by the global setup; WireMock's mapped port is random. */
export const wiremockUrl = () => {
  const url = process.env.E2E_WIREMOCK_URL
  if (!url) throw new Error('E2E_WIREMOCK_URL is not set; run the specs through playwright test')
  return url
}

/** The second WireMock a recording proxies to: its host-mapped URL (to add stubs) and how WireMock reaches it. */
export const upstream = () => {
  const url = process.env.E2E_UPSTREAM_URL
  const internal = process.env.E2E_UPSTREAM_INTERNAL_URL
  if (!url || !internal) throw new Error('E2E_UPSTREAM_URL is not set; run the specs through playwright test')
  return { url, internal }
}
