// Update streams on the fake relay (SPEC §3h): the streaming switch, posting, the cursor feed (long-polled), follows,
// followers and blocks. Every route is holder-checked like the real one.
import type { Call, FakeState } from './fake-relay.ts'
import type { Answer } from './fake-routes.ts'

export interface StreamState {
  streaming: Map<string, { on: boolean, includeStatus: boolean }>
  log: Array<{ id: number, publisher: string, kind: 'post' | 'status', text: string, at: number }>
  follows: Map<string, Map<string, number>>
  blocked: Map<string, Map<string, number>>
  ids: number
  maxFollowers: number
}

export const createStreamState = (): StreamState => ({ streaming: new Map(), log: [], follows: new Map(), blocked: new Map(), ids: 0, maxFollowers: 100 })

const err = (status: number, error: string, extra: Record<string, unknown> = {}): Answer => ({ status, body: { error, ...extra } })
const nameOf = (to: string): string => to.split('@')[0]!.replace(/^[a-z][a-z0-9]{1,7}:/, '')
const addressOf = (s: FakeState, name: string): string => `${s.sessions.get(name)?.kind ?? 'cc'}:${name}`
const isOn = (s: FakeState, name: string): boolean => s.streams.streaming.get(name)?.on === true
const cursorOf = (id: number): string => `u${id}`

const args = (call: Call): Record<string, string> =>
  call.method === 'GET' ? Object.fromEntries(call.query) : (call.body ?? {}) as Record<string, string>

const holds = (s: FakeState, call: Call, name: string): boolean => s.sessions.get(name)?.instanceId === args(call).instanceId

const setStreaming = (s: FakeState, call: Call, name: string): Answer => {
  const body = call.body as { on: boolean, includeStatus?: boolean }
  const value = { on: body.on, includeStatus: body.includeStatus ?? false }
  s.streams.streaming.set(name, value)
  if (!body.on) s.streams.log = s.streams.log.filter((u) => u.publisher !== name)
  return { status: 200, body: value }
}

const post = (s: FakeState, call: Call): Answer => {
  const { from, text } = call.body as { from: string, text: string }
  if (typeof text !== 'string' || text.length < 1 || text.length > 2000) return err(400, 'text_too_long', { max: 2000 })
  if (!isOn(s, from)) return err(409, 'not_streaming')
  const id = ++s.streams.ids
  s.streams.log.push({ id, publisher: from, kind: 'post', text, at: Date.now() })
  for (const wake of [...s.waiters]) wake()
  return { status: 201, body: { id } }
}

const pageOf = (s: FakeState, from: string, after: number) => {
  const followed = s.streams.follows.get(from) ?? new Map()
  const rows = s.streams.log.filter((u) => u.id > after && followed.has(u.publisher) && isOn(s, u.publisher))
  const updates = rows.map((u) => ({ id: u.id, from: addressOf(s, u.publisher), kind: u.kind, text: u.text, at: u.at }))
  return { updates, cursor: cursorOf(rows.at(-1)?.id ?? after) }
}

const feed = async (s: FakeState, call: Call, signal?: AbortSignal): Promise<Answer> => {
  const { from, after: raw } = Object.fromEntries(call.query)
  const after = raw === undefined ? 0 : /^u\d+$/.test(raw) ? Number(raw.slice(1)) : null
  if (after === null) return err(400, 'invalid_cursor')
  const wait = Number(call.query.get('wait') ?? 0)
  if (pageOf(s, from!, after).updates.length === 0 && wait > 0) await waitFor(s, wait * s.waitScaleMs, signal)
  return { status: 200, body: pageOf(s, from!, after) }
}

const waitFor = (s: FakeState, ms: number, signal?: AbortSignal): Promise<void> => new Promise((resolve) => {
  const done = (): void => { clearTimeout(timer); s.waiters.delete(done); resolve() }
  const timer = setTimeout(done, ms)
  s.waiters.add(done)
  signal?.addEventListener('abort', done, { once: true })
})

const follow = (s: FakeState, call: Call): Answer => {
  const { from, to } = call.body as { from: string, to: string }
  const name = nameOf(to)
  if (name === from) return err(400, 'invalid_request')
  if (!s.sessions.has(name)) return err(404, 'unknown_address')
  if (s.streams.blocked.get(name)?.has(addressOf(s, from))) return err(403, 'blocked_by_publisher')
  if (!isOn(s, name)) return err(409, 'not_streaming', { hint: `${addressOf(s, name)} is not streaming` })
  const mine = s.streams.follows.get(from) ?? new Map<string, number>()
  if (!mine.has(name) && mine.size >= 2) return err(409, 'follow_limit', { max: 2 })
  const followers = [...s.streams.follows.values()].filter((m) => m.has(name)).length
  if (!mine.has(name) && followers >= s.streams.maxFollowers) return err(409, 'follower_limit', { max: s.streams.maxFollowers })
  mine.set(name, mine.get(name) ?? Date.now())
  s.streams.follows.set(from, mine)
  return { status: 200, body: { to: addressOf(s, name) } }
}

const following = (s: FakeState, from: string): Answer => {
  const follows = [...(s.streams.follows.get(from) ?? new Map<string, number>())]
    .map(([name, since]) => ({ to: addressOf(s, name), since, active: isOn(s, name) }))
  return { status: 200, body: { follows } }
}

const followersOf = (s: FakeState, from: string): Answer => {
  const followers = [...s.streams.follows].filter(([, m]) => m.has(from)).map(([name, m]) => ({ address: addressOf(s, name), since: m.get(from) }))
  const blocked = [...(s.streams.blocked.get(from) ?? new Map<string, number>())].map(([address, since]) => ({ address, since }))
  return { status: 200, body: { followers, blocked } }
}

const removeFollower = (s: FakeState, from: string, follower: string, block: boolean): Answer => {
  const list = s.streams.blocked.get(from) ?? new Map<string, number>()
  if (block) { s.streams.follows.get(nameOf(follower))?.delete(from); list.set(follower, Date.now()) } else list.delete(follower)
  s.streams.blocked.set(from, list)
  return { status: 204 }
}

const followRoutes = (s: FakeState, call: Call): Answer | undefined => {
  const { from, follower } = args(call)
  if (call.path === '/v1/follows' && call.method === 'PUT') return follow(s, call)
  if (call.path === '/v1/follows' && call.method === 'DELETE') { s.streams.follows.get(from!)?.delete(nameOf(args(call).to!)); return { status: 204 } }
  if (call.path === '/v1/follows') return following(s, from!)
  if (call.path === '/v1/followers' && call.method === 'GET') return followersOf(s, from!)
  if (call.path === '/v1/followers') return removeFollower(s, from!, follower!, true)
  if (call.path === '/v1/followers/blocks') return removeFollower(s, from!, follower!, false)
  return undefined
}

export const streamRoutes = async (s: FakeState, call: Call, signal?: AbortSignal): Promise<Answer | undefined> => {
  const switched = /^\/v1\/sessions\/([^/]+)\/streaming$/.exec(call.path)
  const isStream = switched || call.path === '/v1/updates' || call.path.startsWith('/v1/follow')
  if (!isStream) return undefined
  const name = switched ? decodeURIComponent(switched[1]!) : args(call).from!
  if (!holds(s, call, name)) return err(403, 'not_holder')
  if (switched) return setStreaming(s, call, name)
  if (call.path === '/v1/updates') return call.method === 'POST' ? post(s, call) : feed(s, call, signal)
  return followRoutes(s, call)
}
