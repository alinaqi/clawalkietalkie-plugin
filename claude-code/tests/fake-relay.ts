// A stateful stand-in for the relay server, answering the mod's $.http.fetch. The MCP tests use it too.

import { autoApprove, claim, inboxMessage, INVALID, LISTS, sendMessage, verify, type Call, type Extra, type InboxEntry, type Reply } from './fake-routes.ts'

export { BASELINE, type Call, type Extra, type Reply } from './fake-routes.ts'

interface Init { method?: string, headers?: Record<string, string>, body?: string }

// Fastify refuses a JSON content type with an empty body; so does this stand-in, so the client never sends one.
const isEmptyJson = (init?: Init): boolean =>
  !init?.body && Object.entries(init?.headers ?? {}).some(([k, v]) => k.toLowerCase() === 'content-type' && v.includes('json'))

export const createFakeRelay = () => {
  const calls: Call[] = []
  const inbox: InboxEntry[] = []
  const overrides = new Map<string, Reply>()
  const taken = new Set<string>()
  const settings = { autoApprove: true }

  const route = (method: string, path: string, body: Call['body']): Reply => {
    const key = `${method} ${path.split('?')[0]}`
    const fixed = overrides.get(key) ?? LISTS[key]
    if (fixed) return fixed
    if (key === 'POST /v1/auth/otp') return { status: 202, body: {} }
    if (key === 'POST /v1/auth/verify') return verify(body)
    if (key.endsWith(' /v1/settings/auto-approve')) return autoApprove(method, body, settings)
    if (/^PUT \/v1\/sessions\/[^/]+$/.test(key)) return claim(key.slice('PUT /v1/sessions/'.length), body, taken)
    if (key === 'POST /v1/messages') return sendMessage(body)
    if (key.startsWith('GET /v1/inbox/')) return { status: 200, body: { messages: inbox.splice(0) } }
    return { status: 204 }
  }

  const fetch = (url: string, init?: Init) => {
    const path = url.replace(/^https?:\/\/[^/]+/, '')
    const method = init?.method ?? 'GET'
    const body = init?.body ? JSON.parse(init.body) as Call['body'] : undefined
    calls.push({ method, path, body })
    const reply = isEmptyJson(init) ? INVALID : route(method, path, body)
    const text = reply.body === undefined ? '' : JSON.stringify(reply.body)
    return { status: reply.status, ok: reply.status < 300, headers: {}, text }
  }

  return {
    fetch,
    calls,
    settings,
    deliver: (from: string, text: string, hop?: number, extra: Extra = {}) =>
      inbox.push(inboxMessage({ id: `m${inbox.length + 1}`, from, text, hop }, extra)),
    override: (key: string, reply: Reply) => overrides.set(key, reply),
    take: (name: string) => taken.add(name),
    find: (method: string, prefix: string) => calls.filter((c) => c.method === method && c.path.startsWith(prefix))
  }
}
