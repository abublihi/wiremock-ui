import { AppError, ConfigError, NotFoundError, UpstreamError, ValidationError } from '../errors'
import { decodeRelayBody, readLimited, relayHeaders, relayTarget, RELAY_TIMEOUT_MS, type TestRequestInput, type TestRequestResult } from './relay'
import type { LoggedEvent, NearMiss, ScenarioState, StubMapping } from './types'

const PAGE = 1000

// WireMock 3.13.1 matches the scenario name in /__admin/scenarios/{name}/state without percent-decoding it, so
// only names made of characters a path segment carries unencoded can be addressed (pinned in power-features.test.ts).
// ';' is left out: servlet containers treat it as the start of path parameters.
const SETTABLE_SCENARIO_NAME = /^[A-Za-z0-9\-._~!$&'()*+,=:@]+$/

/** Whether WireMock's admin API can change this scenario's state (see SETTABLE_SCENARIO_NAME). */
export function isScenarioNameSettable(name: string): boolean {
  return SETTABLE_SCENARIO_NAME.test(name) && !name.startsWith('.')
}

class GatewayTimeoutError extends AppError {
  constructor(message: string) {
    super(message, 504)
  }
}

export class WireMockClient {
  private readonly baseUrl: string
  private readonly authHeader?: string
  private readonly fetchFn: typeof fetch
  private readonly timeoutMs: number
  private readonly importTimeoutMs: number
  private readonly relayTimeoutMs: number
  private readonly labels = new WeakMap<Response, string>()

  constructor(opts: {
    baseUrl: string
    user?: string
    password?: string
    fetch?: typeof fetch
    timeoutMs?: number
    importTimeoutMs?: number
    relayTimeoutMs?: number
  }) {
    this.baseUrl = opts.baseUrl.replace(/\/+$/, '')
    this.fetchFn = opts.fetch ?? fetch
    this.timeoutMs = opts.timeoutMs ?? 5000
    this.importTimeoutMs = opts.importTimeoutMs ?? 30000
    this.relayTimeoutMs = opts.relayTimeoutMs ?? RELAY_TIMEOUT_MS
    if (opts.user) {
      this.authHeader = `Basic ${Buffer.from(`${opts.user}:${opts.password ?? ''}`).toString('base64')}`
    }
  }

  get hasCredentials(): boolean {
    return this.authHeader !== undefined
  }

  private async request(path: string, init: RequestInit = {}, timeoutMs = this.timeoutMs): Promise<Response> {
    const headers: Record<string, string> = { ...(init.headers as Record<string, string>) }
    if (this.authHeader) headers.Authorization = this.authHeader
    try {
      const res = await this.fetchFn(`${this.baseUrl}${path}`, { ...init, headers, signal: AbortSignal.timeout(timeoutMs) })
      this.labels.set(res, `${init.method ?? 'GET'} ${path}`)
      return res
    } catch (err) {
      const name = (err as Error).name
      if (name === 'TimeoutError' || name === 'AbortError') {
        throw new UpstreamError(`WireMock request timed out: ${init.method ?? 'GET'} ${path}`)
      }
      throw new UpstreamError(`WireMock unreachable: ${(err as Error).message}`)
    }
  }

  /** Reads a JSON body; a timeout mid-body becomes the same UpstreamError as a timed-out request. */
  private async json<T>(res: Response): Promise<T> {
    try {
      return (await res.json()) as T
    } catch (err) {
      const name = (err as Error).name
      if (name === 'TimeoutError' || name === 'AbortError') {
        throw new UpstreamError(`WireMock request timed out: ${this.labels.get(res) ?? 'request'}`)
      }
      throw err
    }
  }

  private async fail(res: Response, what: string): Promise<never> {
    if (res.status === 401 || res.status === 403) throw new ConfigError('WireMock admin credentials rejected')
    const body = await res.text().catch(() => '') // a failed or timed-out error body is just omitted
    if (res.status >= 400 && res.status < 500) throw new ValidationError(body || `${what} rejected (${res.status})`)
    throw new UpstreamError(`WireMock ${what} failed: ${res.status} ${body}`.trim())
  }

  async importStubs(stubs: StubMapping[], opts: { deleteAllNotInImport: boolean }): Promise<void> {
    const res = await this.request(
      '/__admin/mappings/import',
      {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        mappings: stubs,
        importOptions: { duplicatePolicy: 'OVERWRITE', deleteAllNotInImport: opts.deleteAllNotInImport },
      }),
      },
      this.importTimeoutMs,
    )
    if (!res.ok) await this.fail(res, 'import')
  }

  async getStub(id: string): Promise<StubMapping | null> {
    const res = await this.request(`/__admin/mappings/${encodeURIComponent(id)}`)
    if (res.status === 404) return null
    if (!res.ok) await this.fail(res, 'get stub')
    return this.json<StubMapping>(res)
  }

  async deleteStub(id: string): Promise<void> {
    const res = await this.request(`/__admin/mappings/${encodeURIComponent(id)}`, { method: 'DELETE' })
    if (res.status === 404 || res.ok) return
    await this.fail(res, 'delete stub')
  }

  async listStubIds(): Promise<string[]> {
    return (await this.listStubs()).map((m) => m.id)
  }

  /** Every stub WireMock holds, whole, fetched in pages of 1000. */
  async listStubs(): Promise<StubMapping[]> {
    const all: StubMapping[] = []
    for (let offset = 0; ; offset += PAGE) {
      const res = await this.request(`/__admin/mappings?limit=${PAGE}&offset=${offset}`)
      if (!res.ok) await this.fail(res, 'list stubs')
      const { mappings } = await this.json<{ mappings: StubMapping[] }>(res)
      all.push(...mappings)
      if (mappings.length < PAGE) return all
    }
  }

  async listRequests(opts: { limit: number; since?: string }): Promise<LoggedEvent[]> {
    const q = new URLSearchParams({ limit: String(opts.limit) })
    if (opts.since) q.set('since', opts.since)
    const res = await this.request(`/__admin/requests?${q}`)
    if (!res.ok) await this.fail(res, 'list requests')
    return (await this.json<{ requests: LoggedEvent[] }>(res)).requests
  }

  async getRequest(id: string): Promise<LoggedEvent | null> {
    const res = await this.request(`/__admin/requests/${encodeURIComponent(id)}`)
    if (res.status === 404) return null
    if (!res.ok) await this.fail(res, 'get request')
    return this.json<LoggedEvent>(res)
  }

  async clearRequests(): Promise<void> {
    const res = await this.request('/__admin/requests', { method: 'DELETE' })
    if (!res.ok) await this.fail(res, 'clear requests')
  }

  async countRequests(pattern: Record<string, unknown>): Promise<number> {
    const res = await this.request('/__admin/requests/count', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(pattern),
    })
    if (!res.ok) await this.fail(res, 'count requests')
    return (await this.json<{ count: number }>(res)).count
  }

  async nearMisses(loggedRequest: Record<string, unknown>): Promise<NearMiss[]> {
    const res = await this.request('/__admin/near-misses/request', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(loggedRequest),
    })
    if (!res.ok) await this.fail(res, 'near misses')
    return (await this.json<{ nearMisses: NearMiss[] }>(res)).nearMisses
  }

  /** Every scenario WireMock knows (one per scenarioName on its stubs), with its live state. */
  async listScenarios(): Promise<ScenarioState[]> {
    const res = await this.request('/__admin/scenarios')
    if (!res.ok) await this.fail(res, 'list scenarios')
    const { scenarios } = await this.json<{ scenarios: ScenarioState[] }>(res)
    return scenarios.map(({ name, state, possibleStates }) => ({ name, state, possibleStates }))
  }

  /** NotFoundError when WireMock has no such scenario, ValidationError when the state is not one of its states. */
  async setScenarioState(name: string, state: string): Promise<void> {
    if (!isScenarioNameSettable(name)) {
      throw new ValidationError(
        `WireMock can't set the state of a scenario whose name has spaces or other characters that need URL encoding (${JSON.stringify(name)}). Rename the scenario to letters, digits and - _ . to control it here; Reset all still works.`,
      )
    }
    const res = await this.request(`/__admin/scenarios/${name}/state`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ state }),
    })
    if (res.status === 404) throw new NotFoundError(`Scenario ${JSON.stringify(name)} is not in WireMock`)
    if (!res.ok) await this.fail(res, 'set scenario state')
  }

  /** Every scenario back to Started. */
  async resetScenarios(): Promise<void> {
    const res = await this.request('/__admin/scenarios/reset', { method: 'POST' })
    if (!res.ok) await this.fail(res, 'reset scenarios')
  }

  /**
   * The test-request relay: sends one request to WireMock's stub port at the base URL, without the admin
   * credentials, never following redirects. Refuses anything relay.ts does not allow before sending.
   */
  async sendTestRequest(input: TestRequestInput): Promise<TestRequestResult> {
    const target = relayTarget(this.baseUrl, input.path, input.query)
    const headers = relayHeaders(input.headers)
    // Without this, fetch asks for gzip and decompresses, so the reported headers would not describe the body.
    if (!Object.keys(headers).some((h) => h.toLowerCase() === 'accept-encoding')) headers['Accept-Encoding'] = 'identity'
    const started = performance.now()
    let res: Response
    const signal = AbortSignal.timeout(this.relayTimeoutMs)
    const seconds = Math.round(this.relayTimeoutMs / 1000)
    try {
      res = await this.fetchFn(target, { method: input.method, headers, body: input.body, redirect: 'manual', signal })
    } catch (err) {
      const name = (err as Error).name
      if (name === 'TimeoutError' || name === 'AbortError') throw new GatewayTimeoutError(`WireMock did not answer within ${seconds} s`)
      throw new UpstreamError(`WireMock unreachable: ${(err as Error).message}`)
    }
    let read: Awaited<ReturnType<typeof readLimited>>
    try {
      read = await readLimited(res)
    } catch (err) {
      const name = (err as Error).name
      if (name === 'TimeoutError' || name === 'AbortError') throw new GatewayTimeoutError(`WireMock did not finish the response within ${seconds} s`)
      throw new UpstreamError(`WireMock response failed: ${(err as Error).message}`)
    }
    const durationMs = Math.round(performance.now() - started)
    const responseHeaders: Record<string, string> = {}
    res.headers.forEach((value, name) => {
      responseHeaders[name] = value
    })
    return {
      status: res.status,
      headers: responseHeaders,
      ...decodeRelayBody(read.bytes, res.headers.get('content-type'), read.truncated),
      bodyTruncated: read.truncated,
      durationMs,
      matchedStubId: res.headers.get('matched-stub-id'),
    }
  }

  async version(): Promise<string> {
    const res = await this.request('/__admin/version')
    if (!res.ok) await this.fail(res, 'version')
    return (await this.json<{ version: string }>(res)).version
  }

  async ping(): Promise<boolean> {
    try {
      const res = await this.request('/__admin/mappings?limit=1')
      return res.status === 200
    } catch {
      return false
    }
  }
}
