// A stateful stand-in for the relay server, answering the mod's $.http.fetch. The MCP tests use it too.

import { createFakeInbox } from './fake-inbox.ts'
import { autoApprove, claim, inboxMessage, INVALID, LISTS, verify, type Call, type Extra, type Reply } from './fake-routes.ts'

export { BASELINE, type Call, type Extra, type Reply } from './fake-routes.ts'

interface Init { method?: string, headers?: Record<string, string>, body?: string }

// Fastify refuses a JSON content type with an empty body; so does this stand-in, so the client never sends one.
const isEmptyJson = (init?: Init): boolean =>
  !init?.body && Object.entries(init?.headers ?? {}).some(([k, v]) => k.toLowerCase() === 'content-type' && v.includes('json'))

const lowerKeys = (headers: Record<string, string> = {}): Record<string, string> =>
  Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]))

export const createFakeRelay = () => {
  const calls: Call[] = []
  const inbox = createFakeInbox()
  const overrides = new Map<string, Reply>()
  const taken = new Set<string>()
  const settings = { autoApprove: true }

  const route = (call: Call): Reply => {
    const [bare = '', query = ''] = call.path.split('?')
    const key = `${call.method} ${bare}`
    const fixed = overrides.get(key) ?? LISTS[key]
    if (fixed) return fixed
    if (key === 'POST /v1/auth/otp') return { status: 202, body: {} }
    if (key === 'POST /v1/auth/verify') return verify(call.body)
    if (key.endsWith(' /v1/settings/auto-approve')) return autoApprove(call.method, call.body, settings)
    if (/^PUT \/v1\/sessions\/[^/]+$/.test(key)) return claim(key.slice('PUT /v1/sessions/'.length), call.body, taken)
    if (key === 'POST /v1/messages') return inbox.send(call.body, call.headers['idempotency-key'])
    if (/^POST \/v1\/inbox\/[^/]+\/ack$/.test(key)) return inbox.ack(call.body?.ids)
    if (key.startsWith('GET /v1/inbox/')) return inbox.read(new URLSearchParams(query).get('after'))
    return { status: 204 }
  }

  const fetch = (url: string, init?: Init) => {
    const path = url.replace(/^https?:\/\/[^/]+/, '')
    const body = init?.body ? JSON.parse(init.body) as Call['body'] : undefined
    const call = { method: init?.method ?? 'GET', path, body, headers: lowerKeys(init?.headers) }
    calls.push(call)
    const reply = isEmptyJson(init) ? INVALID : route(call)
    const text = reply.body === undefined ? '' : JSON.stringify(reply.body)
    return { status: reply.status, ok: reply.status < 300, headers: {}, text }
  }

  return {
    fetch,
    calls,
    settings,
    deliver: (from: string, text: string, hop?: number, extra: Extra = {}) =>
      inbox.push(inboxMessage({ id: inbox.nextId(), from, text, hop }, extra)),
    // Messages delivered and not yet acked.
    waiting: () => inbox.size(),
    override: (key: string, reply: Reply) => overrides.set(key, reply),
    restore: (key: string) => overrides.delete(key),
    take: (name: string) => taken.add(name),
    find: (method: string, prefix: string) => calls.filter((c) => c.method === method && c.path.startsWith(prefix))
  }
}
