// The relay's wire: one JSON call, answered as a Result. Takes the fetch to use, so it runs on $.http.fetch.

export interface FetchInit { method?: string, headers?: Record<string, string>, body?: string }
export type Fetch = (url: string, init?: FetchInit) => Promise<{ status: number, ok: boolean, text: string }>

export interface RelayConfig { baseUrl: string, token?: string }

export type Result<T> = { ok: true, value: T } | { ok: false, status: number, error: string }

export type Call = <T>(method: string, path: string, body?: unknown) => Promise<Result<T>>

const parse = (text: string): Record<string, unknown> => {
  try { return text ? JSON.parse(text) as Record<string, unknown> : {} } catch { return {} }
}

// A JSON content type only with a body: the relay refuses one on an empty body.
const headersFor = (token: string | undefined, hasBody: boolean): Record<string, string> => ({
  ...(hasBody ? { 'content-type': 'application/json' } : {}),
  ...(token ? { authorization: `Bearer ${token}` } : {})
})

export const createCall = (fetch: Fetch, config: RelayConfig): Call => {
  const base = config.baseUrl.replace(/\/+$/, '')
  return async <T>(method: string, path: string, body?: unknown): Promise<Result<T>> => {
    const hasBody = body !== undefined
    const init = { method, headers: headersFor(config.token, hasBody), body: hasBody ? JSON.stringify(body) : undefined }
    const res = await fetch(`${base}${path}`, init).catch(() => null)
    if (!res) return { ok: false, status: 0, error: 'unreachable' }
    const json = parse(res.text)
    if (!res.ok) return { ok: false, status: res.status, error: String(json.error ?? 'error') }
    return { ok: true, value: json as T }
  }
}

// One field of a successful answer, like the sessions of GET /v1/sessions.
export const pick = async <T>(pending: Promise<Result<Record<string, unknown>>>, key: string): Promise<Result<T>> => {
  const res = await pending
  return res.ok ? { ok: true, value: res.value[key] as T } : res
}

export const enc = encodeURIComponent
