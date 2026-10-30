// A stateful stand-in for the relay server, answering the mod's $.http.fetch.

export interface Call { method: string, path: string, body: Record<string, unknown> | undefined }
export interface Reply { status: number, body?: unknown }
export interface Extra { delivery?: 'prompt' | 'context', fromPerson?: string | null }
interface Init { method?: string, headers?: Record<string, string>, body?: string }

// Fastify refuses a JSON content type with an empty body; so does this stand-in, so the client never sends one.
const EMPTY_JSON: Reply = { status: 400, body: { error: 'invalid_request' } }
const isEmptyJson = (init?: Init): boolean =>
  !init?.body && Object.entries(init?.headers ?? {}).some(([k, v]) => k.toLowerCase() === 'content-type' && v.includes('json'))

const LISTS: Record<string, Reply> = {
  'GET /v1/teams': { status: 200, body: { teams: [] } },
  'GET /v1/invites': { status: 200, body: { invites: [] } },
  'GET /v1/approvals': { status: 200, body: { approvals: [] } }
}

export const createFakeRelay = () => {
  const calls: Call[] = []
  const inbox: Array<{ id: string, from: string, text: string, sentAt: number, hop?: number } & Extra> = []
  const overrides = new Map<string, Reply>()
  const taken = new Set<string>()

  const route = (method: string, path: string, body: Call['body']): Reply => {
    const key = `${method} ${path.split('?')[0]}`
    const override = overrides.get(key)
    if (override) return override
    if (LISTS[key]) return LISTS[key]
    if (key === 'POST /v1/auth/otp') return { status: 202, body: {} }
    if (key === 'POST /v1/auth/verify') {
      return body?.code === '123456' ? { status: 200, body: { token: 'tok-1', email: body.email } } : { status: 401, body: { error: 'invalid_code' } }
    }
    if (method === 'PUT' && key.startsWith('PUT /v1/sessions/')) {
      const name = key.slice('PUT /v1/sessions/'.length)
      return taken.has(name) ? { status: 409, body: { error: 'name_taken' } } : { status: 200, body: { address: `${body?.kind ?? 'cc'}:${name}` } }
    }
    if (key === 'GET /v1/sessions') return { status: 200, body: { sessions: [{ address: 'cc:happy-cat', online: true, lastSeen: 0, host: 'mac', cwd: 'api' }] } }
    if (key === 'POST /v1/messages') return { status: 201, body: { id: 'm-new', online: true } }
    if (key.startsWith('GET /v1/inbox/')) return { status: 200, body: { messages: inbox.splice(0) } }
    return { status: 204 }
  }

  const fetch = (url: string, init?: Init) => {
    const path = url.replace(/^https?:\/\/[^/]+/, '')
    const method = init?.method ?? 'GET'
    const body = init?.body ? JSON.parse(init.body) as Call['body'] : undefined
    calls.push({ method, path, body })
    const reply = isEmptyJson(init) ? EMPTY_JSON : route(method, path, body)
    const text = reply.body === undefined ? '' : JSON.stringify(reply.body)
    return { status: reply.status, ok: reply.status < 300, headers: {}, text }
  }

  return {
    fetch,
    calls,
    deliver: (from: string, text: string, hop?: number, extra: Extra = {}) =>
      inbox.push({ id: `m${inbox.length + 1}`, from, text, sentAt: 0, hop, ...extra }),
    override: (key: string, reply: Reply) => overrides.set(key, reply),
    take: (name: string) => taken.add(name),
    find: (method: string, prefix: string) => calls.filter((c) => c.method === method && c.path.startsWith(prefix))
  }
}
