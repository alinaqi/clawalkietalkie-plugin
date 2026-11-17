// The routes of the fake relay. Answers { status, body } or a Response (file content).
import type { Call, FakeState } from './fake-relay.ts'
import { messageRoutes } from './fake-messages.ts'

export type Answer = { status: number, body?: unknown } | Response

const ok = (body?: unknown, status = 200): Answer => ({ status, body })
const err = (status: number, error: string, extra: Record<string, unknown> = {}): Answer => ({ status, body: { error, ...extra } })

const auth = (call: Call): Answer | undefined => {
  const body = call.body as Record<string, string>
  if (call.path === '/v1/auth/otp') return ok({}, 202)
  if (call.path !== '/v1/auth/verify') return undefined
  return body.code === '123456' ? ok({ token: 'tok_new', email: body.email }) : err(401, 'invalid_code')
}

const deviceTokens = (call: Call): Answer | undefined => {
  if (!call.path.startsWith('/v1/auth/device-tokens')) return undefined
  if (call.method === 'POST') return ok({ id: '0123456789abcdef', token: 'tok_minted', device: (call.body as { device: string }).device }, 201)
  if (call.method === 'GET') return ok({ tokens: [{ id: '0123456789abcdef', device: 'd', createdAt: 1, expiresAt: 2, minted: true, current: false }] })
  return call.path.endsWith('/0123456789abcdef') ? ok(undefined, 204) : err(404, 'unknown_token')
}

const claim = (s: FakeState, call: Call, name: string): Answer => {
  const body = call.body as { instanceId: string, kind?: string, client?: string, cwd?: string }
  const held = s.sessions.get(name)
  if (held && held.live && held.instanceId !== body.instanceId) return err(409, 'name_taken')
  const kind = body.kind ?? (body.client ? body.client.replace(/[^a-z]/g, '').slice(0, 2) : 'cc')
  s.sessions.set(name, { name, kind, instanceId: body.instanceId, live: true, closed: false, cwd: body.cwd })
  return ok({ address: `${kind}:${name}` })
}

const holder = (s: FakeState, name: string, instanceId: unknown): boolean => s.sessions.get(name)?.instanceId === instanceId

const sessions = (s: FakeState, call: Call): Answer | undefined => {
  const match = /^\/v1\/sessions\/([^/]+)(\/close|\/status)?$/.exec(call.path)
  if (!match) return undefined
  const name = decodeURIComponent(match[1]!)
  const body = call.body as { instanceId: string }
  if (!match[2] && call.method === 'PUT') return claim(s, call, name)
  if (!holder(s, name, body.instanceId)) return err(403, 'not_holder')
  if (match[2] === '/close') s.sessions.get(name)!.closed = true
  if (match[2] === '/status') s.keys.set(`status:${name}`, call.body)
  if (!match[2]) s.sessions.delete(name)
  return ok(undefined, 204)
}

const listing = (s: FakeState, call: Call): Answer | undefined => {
  if (call.method !== 'GET') return undefined
  if (call.path === '/v1/me') return ok({ kind: 'person', email: 'me@example.com' })
  if (call.path === '/v1/kinds') return ok({ kinds: [{ kind: 'cc', product: 'claude-code', label: 'Claude Code', builtIn: true, verified: true }] })
  if (call.path === '/v1/activity') return ok({ events: [], cursor: call.query.get('after') ?? '0' })
  if (call.path !== '/v1/sessions') return undefined
  const list = [...s.sessions.values()].map((x) => ({ address: `${x.kind}:${x.name}`, online: x.live, lastSeen: 1, host: null, cwd: x.cwd ?? null, status: null, closed: x.closed }))
  return ok({ sessions: list })
}

const files = (s: FakeState, call: Call): Answer | undefined => {
  if (call.path === '/v1/files' && call.method === 'POST') {
    const id = `f${++s.ids}`
    const bytes = call.body as Uint8Array
    s.files.set(id, { name: call.query.get('name')!, bytes })
    return ok({ id, name: call.query.get('name'), size: bytes.length, mime: 'text/plain', sha256: 'x', status: 'clean', createdAt: 1 }, 201)
  }
  const match = /^\/v1\/files\/([^/]+)\/content$/.exec(call.path)
  const file = match && s.files.get(match[1]!)
  if (match && !file) return err(404, 'unknown_file')
  return file ? new Response(file.bytes as unknown as BodyInit, { status: 200, headers: { 'content-type': 'text/plain' } }) : undefined
}

export const routes = async (s: FakeState, call: Call, signal?: AbortSignal): Promise<Answer> =>
  auth(call) ?? deviceTokens(call) ?? listing(s, call) ?? sessions(s, call) ?? files(s, call) ??
    await messageRoutes(s, call, signal) ?? err(404, 'not_found')
