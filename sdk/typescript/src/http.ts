// The relay's wire: one call, answered as parsed JSON (or bytes), or thrown as a ClawalkietalkieError.
import { ClawalkietalkieError, errorFor } from './errors.ts'

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>

export const DEFAULT_SERVER = 'https://api.clawalkietalkie.com'
export const DEFAULT_TIMEOUT_MS = 30_000

export interface Wire { server: string, token?: string, fetch: FetchLike, timeoutMs: number }

export interface Req {
  method: string, path: string, query?: Record<string, string | number | undefined>, json?: unknown
  bytes?: Uint8Array, headers?: Record<string, string>, signal?: AbortSignal, timeoutMs?: number, raw?: boolean
}

const urlOf = (wire: Wire, req: Req): string => {
  const query = Object.entries(req.query ?? {}).filter((e): e is [string, string | number] => e[1] !== undefined)
  const search = query.length ? `?${new URLSearchParams(query.map(([k, v]) => [k, String(v)]))}` : ''
  return `${wire.server.replace(/\/+$/, '')}${req.path}${search}`
}

// A JSON content type only with a JSON body: the relay refuses one on an empty body.
const initOf = (wire: Wire, req: Req, signal: AbortSignal): RequestInit => {
  const headers: Record<string, string> = { accept: 'application/json', ...req.headers }
  if (wire.token) headers.authorization = `Bearer ${wire.token}`
  if (req.json !== undefined) headers['content-type'] = 'application/json'
  if (req.bytes) headers['content-type'] = 'application/octet-stream'
  const body = req.json !== undefined ? JSON.stringify(req.json) : req.bytes
  return { method: req.method, headers, body: body as BodyInit | undefined, signal }
}

// Links the caller's signal to a timeout (AbortSignal.any is not in Node 18).
const deadline = (outer: AbortSignal | undefined, ms: number) => {
  const inner = new AbortController()
  const state = { timedOut: false }
  const timer = setTimeout(() => { state.timedOut = true; inner.abort() }, ms)
  const onAbort = (): void => inner.abort()
  if (outer?.aborted) inner.abort()
  outer?.addEventListener('abort', onAbort, { once: true })
  const done = (): void => { clearTimeout(timer); outer?.removeEventListener('abort', onAbort) }
  return { signal: inner.signal, state, done }
}

const refusal = async (res: Response): Promise<ClawalkietalkieError> => {
  const text = await res.text().catch(() => '')
  let json: Record<string, unknown> = {}
  try { json = JSON.parse(text) as Record<string, unknown> } catch { /* not JSON: a proxy's page */ }
  const { error, ...details } = json && typeof json === 'object' ? json : {}
  return errorFor(res.status, typeof error === 'string' ? error : `http_${res.status}`, details)
}

const failure = (state: { timedOut: boolean }, outer?: AbortSignal): ClawalkietalkieError => {
  if (state.timedOut) return new ClawalkietalkieError(0, 'timeout')
  return new ClawalkietalkieError(0, outer?.aborted ? 'aborted' : 'unreachable')
}

const bodyOf = async (res: Response, raw: boolean | undefined): Promise<unknown> => {
  if (raw) return new Uint8Array(await res.arrayBuffer())
  const text = await res.text()
  return text ? JSON.parse(text) as unknown : undefined
}

export const request = async <T>(wire: Wire, req: Req): Promise<T> => {
  const limit = deadline(req.signal, req.timeoutMs ?? wire.timeoutMs)
  try {
    const res = await wire.fetch(urlOf(wire, req), initOf(wire, req, limit.signal)).catch(() => { throw failure(limit.state, req.signal) })
    if (!res.ok) throw await refusal(res)
    return await bodyOf(res, req.raw).catch((e: unknown) => { throw e instanceof ClawalkietalkieError ? e : failure(limit.state, req.signal) }) as T
  } finally {
    limit.done()
  }
}

export const enc = encodeURIComponent
