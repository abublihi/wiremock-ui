import { ConfigError, UpstreamError, ValidationError } from '../errors'
import type { LoggedEvent, NearMiss, StubMapping } from './types'

const PAGE = 1000

export class WireMockClient {
  private readonly baseUrl: string
  private readonly authHeader?: string
  private readonly fetchFn: typeof fetch
  private readonly timeoutMs: number
  private readonly importTimeoutMs: number
  private readonly labels = new WeakMap<Response, string>()

  constructor(opts: {
    baseUrl: string
    user?: string
    password?: string
    fetch?: typeof fetch
    timeoutMs?: number
    importTimeoutMs?: number
  }) {
    this.baseUrl = opts.baseUrl.replace(/\/+$/, '')
    this.fetchFn = opts.fetch ?? fetch
    this.timeoutMs = opts.timeoutMs ?? 5000
    this.importTimeoutMs = opts.importTimeoutMs ?? 30000
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
