// A small in-memory relay behind a fetch function: the shapes, status codes and errors of the real one (SPEC §3),
// enough to drive the SDK. `fail` queues a one-off answer (or a network error) for the next matching call.
import { routes } from './fake-routes.ts'
import { pushInbox } from './fake-messages.ts'

export interface Call { method: string, path: string, query: URLSearchParams, headers: Record<string, string>, body: unknown }
export interface Queued { method?: string, path: RegExp, status: number, body?: unknown, network?: boolean, afterMs?: number }
export interface Stored { seq: number, message: Record<string, unknown> }
export interface Session { name: string, kind: string, instanceId: string, live: boolean, closed: boolean, cwd?: string }

export interface FakeState {
  calls: Call[]
  failures: Queued[]
  sessions: Map<string, Session>
  inboxes: Map<string, Stored[]>
  statuses: Map<string, { status: string, replies: Array<Record<string, unknown>> }>
  files: Map<string, { name: string, bytes: Uint8Array }>
  keys: Map<string, unknown>
  seq: number
  ids: number
  waiters: Set<() => void>
  waitScaleMs: number
}

export const TOKEN = 'tok_test_secret'

const createState = (): FakeState => ({
  calls: [], failures: [], sessions: new Map(), inboxes: new Map(), statuses: new Map(), files: new Map(), keys: new Map(),
  seq: 0, ids: 0, waiters: new Set(), waitScaleMs: 5
})

const json = (status: number, body?: unknown): Response =>
  new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

const bodyOf = async (init: RequestInit | undefined): Promise<unknown> => {
  if (init?.body === undefined || init.body === null) return undefined
  if (typeof init.body === 'string') return JSON.parse(init.body)
  return new Uint8Array(init.body as ArrayBuffer)
}

const headersOf = (init: RequestInit | undefined): Record<string, string> =>
  Object.fromEntries(Object.entries((init?.headers ?? {}) as Record<string, string>).map(([k, v]) => [k.toLowerCase(), v]))

const takeFailure = (s: FakeState, call: Call): Queued | undefined => {
  const at = s.failures.findIndex((f) => f.path.test(call.path) && (!f.method || f.method === call.method))
  return at === -1 ? undefined : s.failures.splice(at, 1)[0]
}

export const createFakeRelay = () => {
  const state = createState()
  const fetch = async (input: string | URL, init?: RequestInit): Promise<Response> => {
    const url = new URL(String(input))
    const call: Call = { method: init?.method ?? 'GET', path: url.pathname, query: url.searchParams, headers: headersOf(init), body: await bodyOf(init) }
    state.calls.push(call)
    const failure = takeFailure(state, call)
    if (failure?.afterMs) await new Promise((r) => setTimeout(r, failure.afterMs))
    if (failure?.network) throw new TypeError('fetch failed')
    if (failure) return json(failure.status, failure.body)
    if (call.headers.authorization !== `Bearer ${TOKEN}` && !call.path.startsWith('/v1/auth/')) return json(401, { error: 'unauthorized' })
    const answer = await routes(state, call, init?.signal ?? undefined)
    return answer instanceof Response ? answer : json(answer.status, answer.body)
  }
  const deliver = (name: string, message: Record<string, unknown>): void => pushInbox(state, name, { hop: 0, type: 'request', ...message })
  const callsTo = (path: RegExp, method?: string): Call[] => state.calls.filter((c) => path.test(c.path) && (!method || c.method === method))
  return { fetch, state, deliver, callsTo, fail: (q: Queued) => { state.failures.push(q) } }
}

export type FakeRelay = ReturnType<typeof createFakeRelay>
