import { UpstreamError, ValidationError } from '../errors'
import type { StubMapping } from './types'

const PAGE = 1000

export class WireMockClient {
  private readonly baseUrl: string
  private readonly authHeader?: string
  private readonly fetchFn: typeof fetch

  constructor(opts: { baseUrl: string; user?: string; password?: string; fetch?: typeof fetch }) {
    this.baseUrl = opts.baseUrl.replace(/\/+$/, '')
    this.fetchFn = opts.fetch ?? fetch
    if (opts.user) {
      this.authHeader = `Basic ${Buffer.from(`${opts.user}:${opts.password ?? ''}`).toString('base64')}`
    }
  }

  private async request(path: string, init: RequestInit = {}): Promise<Response> {
    const headers: Record<string, string> = { ...(init.headers as Record<string, string>) }
    if (this.authHeader) headers.Authorization = this.authHeader
    try {
      return await this.fetchFn(`${this.baseUrl}${path}`, { ...init, headers })
    } catch (err) {
      throw new UpstreamError(`WireMock unreachable: ${(err as Error).message}`)
    }
  }

  private async fail(res: Response, what: string): Promise<never> {
    const body = await res.text().catch(() => '')
    if (res.status >= 400 && res.status < 500) throw new ValidationError(body || `${what} rejected (${res.status})`)
    throw new UpstreamError(`WireMock ${what} failed: ${res.status} ${body}`.trim())
  }

  async importStubs(stubs: StubMapping[], opts: { deleteAllNotInImport: boolean }): Promise<void> {
    const res = await this.request('/__admin/mappings/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        mappings: stubs,
        importOptions: { duplicatePolicy: 'OVERWRITE', deleteAllNotInImport: opts.deleteAllNotInImport },
      }),
    })
    if (!res.ok) await this.fail(res, 'import')
  }

  async getStub(id: string): Promise<StubMapping | null> {
    const res = await this.request(`/__admin/mappings/${encodeURIComponent(id)}`)
    if (res.status === 404) return null
    if (!res.ok) await this.fail(res, 'get stub')
    return (await res.json()) as StubMapping
  }

  async deleteStub(id: string): Promise<void> {
    const res = await this.request(`/__admin/mappings/${encodeURIComponent(id)}`, { method: 'DELETE' })
    if (res.status === 404 || res.ok) return
    await this.fail(res, 'delete stub')
  }

  async listStubIds(): Promise<string[]> {
    const ids: string[] = []
    for (let offset = 0; ; offset += PAGE) {
      const res = await this.request(`/__admin/mappings?limit=${PAGE}&offset=${offset}`)
      if (!res.ok) await this.fail(res, 'list stubs')
      const { mappings } = (await res.json()) as { mappings: { id: string }[] }
      ids.push(...mappings.map((m) => m.id))
      if (mappings.length < PAGE) return ids
    }
  }

  async version(): Promise<string> {
    const res = await this.request('/__admin/version')
    if (!res.ok) await this.fail(res, 'version')
    return ((await res.json()) as { version: string }).version
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
