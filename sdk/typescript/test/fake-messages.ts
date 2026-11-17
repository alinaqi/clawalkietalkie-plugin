// Messages on the fake relay: send (with Idempotency-Key), inbox long-poll with cursors, ack, discard, status, replies.
import type { Call, FakeState, Stored } from './fake-relay.ts'
import type { Answer } from './fake-routes.ts'

const cursorOf = (seq: number): string => `c${seq}`
const seqOf = (cursor: string): number | null => /^c\d+$/.test(cursor) ? Number(cursor.slice(1)) : null

const err = (status: number, error: string, extra: Record<string, unknown> = {}): Answer => ({ status, body: { error, ...extra } })

const nameOf = (to: string): string => to.split('@')[0]!.replace(/^[a-z][a-z0-9]{1,7}:/, '')

const send = (s: FakeState, call: Call): Answer => {
  const body = call.body as { from: string, instanceId: string, to: string, text: string, type?: string, replyTo?: string, hop?: number }
  const key = call.headers['idempotency-key']
  if (key && s.keys.has(key)) return { status: 201, body: s.keys.get(key) }
  if (s.sessions.get(body.from)?.instanceId !== body.instanceId) return err(403, 'not_holder')
  const target = s.sessions.get(nameOf(body.to))
  if (!target) return err(404, 'unknown_address')
  const id = `m${++s.ids}`
  const sent = { id, online: target.live, to: `${target.kind}:${target.name}`, delivery: 'context', type: body.type ?? 'note', status: 'queued', thread: id }
  s.statuses.set(id, { status: 'queued', replies: [] })
  const answered = body.replyTo ? s.statuses.get(body.replyTo) : undefined
  if (answered) { answered.status = 'replied'; answered.replies.push({ id, from: `${s.sessions.get(body.from)!.kind}:${body.from}`, text: body.text, sentAt: 1 }) }
  pushInbox(s, target.name, { id, from: `${s.sessions.get(body.from)!.kind}:${body.from}`, text: body.text, type: body.type ?? 'note', hop: body.hop ?? 0, ...(body.replyTo ? { replyTo: body.replyTo } : {}) })
  if (key) s.keys.set(key, sent)
  return { status: 201, body: sent }
}

export const pushInbox = (s: FakeState, name: string, message: Record<string, unknown>): void => {
  const list = s.inboxes.get(name) ?? []
  list.push({ seq: ++s.seq, message: { sentAt: Date.now(), delivery: 'context', fromPerson: null, ...message } })
  s.inboxes.set(name, list)
  for (const wake of [...s.waiters]) wake()
}

const waitFor = (s: FakeState, ms: number, signal?: AbortSignal): Promise<void> => new Promise((resolve) => {
  const done = (): void => { clearTimeout(timer); s.waiters.delete(done); resolve() }
  const timer = setTimeout(done, ms)
  s.waiters.add(done)
  signal?.addEventListener('abort', done, { once: true })
})

const pageOf = (list: Stored[], after: number | null): { messages: unknown[], cursor: string | null } => {
  const page = after === null ? list : list.filter((m) => m.seq > after)
  if (after !== null) return { messages: page.map((m) => m.message), cursor: cursorOf(page.at(-1)?.seq ?? after) }
  return { messages: page.map((m) => m.message), cursor: page.length ? cursorOf(Math.max(...page.map((m) => m.seq))) : null }
}

const inbox = async (s: FakeState, call: Call, name: string, signal?: AbortSignal): Promise<Answer> => {
  if (s.sessions.get(name)?.instanceId !== call.query.get('instanceId')) return err(403, 'not_holder')
  const raw = call.query.get('after')
  const after = raw === null ? null : seqOf(raw)
  if (raw !== null && after === null) return err(400, 'invalid_request')
  const read = () => pageOf(s.inboxes.get(name) ?? [], after)
  if (read().messages.length === 0 && Number(call.query.get('wait') ?? 0) > 0) await waitFor(s, Number(call.query.get('wait')) * s.waitScaleMs, signal)
  return { status: 200, body: read() }
}

const remove = (s: FakeState, call: Call, name: string, discarded: boolean): Answer => {
  const body = call.body as { instanceId: string, ids: string[] }
  if (s.sessions.get(name)?.instanceId !== body.instanceId) return err(403, 'not_holder')
  s.inboxes.set(name, (s.inboxes.get(name) ?? []).filter((m) => !body.ids.includes(m.message.id as string)))
  for (const id of discarded ? body.ids : []) { const st = s.statuses.get(id); if (st) st.status = 'discarded' }
  return { status: 204 }
}

const status = (s: FakeState, id: string): Answer => {
  const found = s.statuses.get(id)
  return found ? { status: 200, body: { id, status: found.status, deliveredAt: null, replyTo: null, thread: id, replies: found.replies } } : err(404, 'unknown_message')
}

const replies = async (s: FakeState, call: Call, signal?: AbortSignal): Promise<Answer> => {
  const id = call.query.get('to')!
  const found = s.statuses.get(id)
  if (!found) return err(404, 'unknown_message')
  if (found.replies.length === 0) await waitFor(s, Number(call.query.get('wait') ?? 0) * s.waitScaleMs, signal)
  return { status: 200, body: { replies: found.replies, status: found.status } }
}

export const messageRoutes = async (s: FakeState, call: Call, signal?: AbortSignal): Promise<Answer | undefined> => {
  if (call.path === '/v1/messages' && call.method === 'POST') return send(s, call)
  if (call.path === '/v1/replies') return replies(s, call, signal)
  const message = /^\/v1\/messages\/([^/]+)$/.exec(call.path)
  if (message) return status(s, decodeURIComponent(message[1]!))
  const box = /^\/v1\/inbox\/([^/]+)(\/ack|\/discard)?$/.exec(call.path)
  if (!box) return undefined
  const name = decodeURIComponent(box[1]!)
  return box[2] ? remove(s, call, name, box[2] === '/discard') : inbox(s, call, name, signal)
}
