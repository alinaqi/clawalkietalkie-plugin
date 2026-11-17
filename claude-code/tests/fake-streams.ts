// The fake relay's update streams (§3h): the streaming switch, the log, the feed and follows. The MCP tests use it too.

import { INVALID, type Body, type Reply } from './fake-routes.ts'

export interface FakeUpdate { id: number, from: string, kind: 'post' | 'status', text: string, at: number, seq: number }

const CURSOR = /^u(\d+)$/
const NO_CONTENT: Reply = { status: 204 }

// The agents the fake knows: cc:happy-cat streams, cc:quiet-owl does not.
const KNOWN = new Set(['happy-cat', 'quiet-owl', 'happy-dog'])
const nameOf = (to: unknown): string => String(to ?? '').split('@')[0]!.replace(/^[a-z0-9]+:/, '')
const addressOf = (to: unknown): string => `cc:${nameOf(to)}${String(to).includes('@') ? `@${String(to).split('@')[1]}` : ''}`

export const createFakeStreams = () => {
  const log: FakeUpdate[] = []
  const streaming = new Map<string, { on: boolean, includeStatus: boolean }>([['happy-cat', { on: true, includeStatus: false }]])
  const follows = new Map<string, number>()
  const followers = [{ address: 'cc:happy-cat', since: 1 }]
  const blocked = [{ address: 'cc:nosy-fox', since: 2 }]
  let seq = 0

  const isStreaming = (name: string): boolean => streaming.get(name)?.on === true

  const setStreaming = (name: string, body: Body): Reply => {
    if (typeof body?.on !== 'boolean') return INVALID
    const state = { on: body.on, includeStatus: body.includeStatus === true }
    streaming.set(name, state)
    return { status: 200, body: state }
  }

  const post = (body: Body): Reply => {
    const text = String(body?.text ?? '').trim()
    if (text.length < 1 || text.length > 2000) return INVALID
    if (!isStreaming(nameOf(body?.from))) return { status: 409, body: { error: 'not_streaming' } }
    return { status: 201, body: { id: publish(addressOf(body?.from), text).id } }
  }

  const follow = (body: Body): Reply => {
    const name = nameOf(body?.to)
    if (name === nameOf(body?.from)) return { status: 400, body: { error: 'invalid_request', message: 'An agent cannot follow itself.' } }
    if (!KNOWN.has(name)) return { status: 404, body: { error: 'unknown_address' } }
    if (!isStreaming(name)) return { status: 409, body: { error: 'not_streaming', hint: `${addressOf(body?.to)} has not turned on streaming.` } }
    if (!follows.has(addressOf(body?.to))) follows.set(addressOf(body?.to), 100 + follows.size)
    return { status: 200, body: { to: addressOf(body?.to) } }
  }

  const read = (after: string | null): Reply => {
    const match = after === null ? null : CURSOR.exec(after)
    if (after !== null && !match) return { status: 400, body: { error: 'invalid_request' } }
    const from = match ? Number(match[1]) : 0
    const page = log.filter((u) => u.seq > from && follows.has(u.from))
    const cursor = page.length > 0 ? `u${page.at(-1)!.seq}` : after ?? 'u0'
    return { status: 200, body: { updates: page.map(({ seq: _seq, ...u }) => u), cursor } }
  }

  const publish = (from: string, text: string, kind: 'post' | 'status' = 'post'): FakeUpdate => {
    const update = { id: ++seq, from, kind, text, at: Date.UTC(2026, 10, 17, 12, seq), seq }
    log.push(update)
    return update
  }

  const unfollow = (body: Body): Reply => {
    follows.delete(addressOf(body?.to))
    return NO_CONTENT
  }

  const listFollows = (): Reply =>
    ({ status: 200, body: { follows: [...follows].map(([to, since]) => ({ to, since, active: isStreaming(nameOf(to)) })) } })

  const route = (key: string, query: URLSearchParams, body: Body): Reply | undefined => {
    if (/^PUT \/v1\/sessions\/[^/]+\/streaming$/.test(key)) return setStreaming(key.split('/')[3]!, body)
    if (key === 'POST /v1/updates') return post(body)
    if (key === 'GET /v1/updates') return read(query.get('after'))
    if (key === 'PUT /v1/follows') return follow(body)
    if (key === 'DELETE /v1/follows') return unfollow(body)
    if (key === 'GET /v1/follows') return listFollows()
    if (key === 'GET /v1/followers') return { status: 200, body: { followers, blocked } }
    if (key === 'DELETE /v1/followers' || key === 'DELETE /v1/followers/blocks') return NO_CONTENT
    return undefined
  }

  return { route, publish, isStreaming, following: () => [...follows.keys()], follow: (to: string) => follows.set(to, 1) }
}
