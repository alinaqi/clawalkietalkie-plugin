// A typed client for the relay API. Takes the fetch to use, so it runs on $.http.fetch.

export interface FetchInit { method?: string, headers?: Record<string, string>, body?: string }
export type Fetch = (url: string, init?: FetchInit) => Promise<{ status: number, ok: boolean, text: string }>

export interface RelayConfig { baseUrl: string, token?: string }

export type Result<T> = { ok: true, value: T } | { ok: false, status: number, error: string }

export interface SessionInfo { address: string, online: boolean, lastSeen: number, host: string | null, cwd: string | null }
export interface InboxMessage { id: string, from: string, text: string, sentAt: number, hop?: number }
export interface ClaimBody { instanceId: string, kind?: string, host?: string, cwd?: string }
export interface SendBody { from: string, instanceId: string, to: string, text: string, hop?: number }

const parse = (text: string): Record<string, unknown> => {
  try { return text ? JSON.parse(text) as Record<string, unknown> : {} } catch { return {} }
}

export const createRelay = (fetch: Fetch, config: RelayConfig) => {
  const base = config.baseUrl.replace(/\/+$/, '')

  const call = async <T>(method: string, path: string, body?: unknown): Promise<Result<T>> => {
    const headers: Record<string, string> = { 'content-type': 'application/json' }
    if (config.token) headers.authorization = `Bearer ${config.token}`
    const init = { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }
    const res = await fetch(`${base}${path}`, init).catch(() => null)
    if (!res) return { ok: false, status: 0, error: 'unreachable' }
    const json = parse(res.text)
    if (!res.ok) return { ok: false, status: res.status, error: String(json.error ?? 'error') }
    return { ok: true, value: json as T }
  }

  const pick = async <T>(pending: Promise<Result<Record<string, unknown>>>, key: string): Promise<Result<T>> => {
    const res = await pending
    return res.ok ? { ok: true, value: res.value[key] as T } : res
  }

  const enc = encodeURIComponent

  return {
    requestCode: (email: string) => call<object>('POST', '/v1/auth/otp', { email }),
    verify: (body: { email: string, code: string, device: string }) =>
      call<{ token: string, email: string }>('POST', '/v1/auth/verify', body),
    revoke: () => call<object>('DELETE', '/v1/auth/token'),
    claim: (name: string, body: ClaimBody) => pick<string>(call('PUT', `/v1/sessions/${enc(name)}`, body), 'address'),
    unclaim: (name: string, instanceId: string) => call<object>('DELETE', `/v1/sessions/${enc(name)}`, { instanceId }),
    list: () => pick<SessionInfo[]>(call('GET', '/v1/sessions'), 'sessions'),
    send: (body: SendBody) => call<{ id: string, online: boolean, to?: string }>('POST', '/v1/messages', body),
    inbox: (name: string, instanceId: string, wait: number) =>
      pick<InboxMessage[]>(call('GET', `/v1/inbox/${enc(name)}?instanceId=${enc(instanceId)}&wait=${wait}`), 'messages'),
    ack: (name: string, instanceId: string, ids: readonly string[]) =>
      call<object>('POST', `/v1/inbox/${enc(name)}/ack`, { instanceId, ids })
  }
}

export type Relay = ReturnType<typeof createRelay>
