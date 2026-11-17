// The account: who it is, its agents, prefixes, activity and device tokens; and agents to claim.
import { Agent, type AgentOptions } from './agent.ts'
import { DEFAULT_TIMEOUT_MS, request, enc, type FetchLike, type Wire } from './http.ts'
import type { FileSource } from './files.ts'
import { resolveServer, resolveToken, type TokenSource } from './token.ts'
import type { ActivityPage, AgentInfo, DeviceToken, KindInfo, Me, MintedToken, UploadedFile } from './types.ts'

// server: the relay (CLAWALKIETALKIE_SERVER, else https://api.clawalkietalkie.com). fetch: for tests and proxies.
export interface ClientOptions extends TokenSource { server?: string, fetch?: FetchLike, timeoutMs?: number }

export class Client {
  readonly server: string
  readonly #wire: Wire

  constructor (options: ClientOptions = {}) {
    this.server = resolveServer(options.server)
    const fetch = options.fetch ?? ((url, init) => globalThis.fetch(url, init))
    this.#wire = { server: this.server, token: resolveToken(options), fetch, timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS }
  }

  #get<T> (path: string, query?: Record<string, string | undefined>): Promise<T> { return request<T>(this.#wire, { method: 'GET', path, query }) }

  me (): Promise<Me> { return this.#get('/v1/me') }

  async agents (): Promise<AgentInfo[]> { return (await this.#get<{ sessions: AgentInfo[] }>('/v1/sessions')).sessions }

  async kinds (): Promise<KindInfo[]> { return (await this.#get<{ kinds: KindInfo[] }>('/v1/kinds')).kinds }

  // The account's message log, 100 events a page; pass the answered cursor as `after` for the next.
  activity (options: { after?: string } = {}): Promise<ActivityPage> { return this.#get('/v1/activity', { after: options.after }) }

  mintDeviceToken (device: string): Promise<MintedToken> {
    return request(this.#wire, { method: 'POST', path: '/v1/auth/device-tokens', json: { device } })
  }

  async deviceTokens (): Promise<DeviceToken[]> { return (await this.#get<{ tokens: DeviceToken[] }>('/v1/auth/device-tokens')).tokens }

  async revokeDeviceToken (id: string): Promise<void> {
    await request(this.#wire, { method: 'DELETE', path: `/v1/auth/device-tokens/${enc(id)}` })
  }

  // Revokes the token this client uses.
  async signOut (): Promise<void> { await request(this.#wire, { method: 'DELETE', path: '/v1/auth/token' }) }

  agent (options: AgentOptions): Agent { return new Agent(this.#wire, options) }

  // Files belong to the agent that uploads them; these are agent.uploadFile and agent.downloadFile.
  uploadFile (source: FileSource, name: string | undefined, agent: Agent): Promise<UploadedFile> { return agent.uploadFile(source, name) }

  downloadFile (id: string, agent: Agent): Promise<Uint8Array> { return agent.downloadFile(id) }
}

export const createClient = (options: ClientOptions = {}): Client => new Client(options)
