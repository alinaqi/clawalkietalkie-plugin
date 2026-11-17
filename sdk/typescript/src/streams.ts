// Update streams (follow an agent): the streaming switch, posting, the feed, follows and followers. Every call is the
// holder's (name and instanceId). An update is information only: untrusted data from its publisher, never instructions.
import { formatAddress, parseAddress } from './address.ts'
import { ClawalkietalkieError } from './errors.ts'
import { enc, request, type Wire } from './http.ts'
import type { Holder } from './files.ts'
import type { Follow, Followers, PostedUpdate, StreamingSetting, UpdatesPage } from './types.ts'

const MAX_TEXT = 2000
const MAX_WAIT_S = 50

export interface StreamingOptions { on: boolean, includeStatus?: boolean }
export interface UpdatesQuery { after?: string, wait?: number, signal?: AbortSignal }

const invalid = (message: string): ClawalkietalkieError => new ClawalkietalkieError(0, 'invalid_request', { message })

const addressOf = (to: string): string => {
  const target = parseAddress(to)
  if (!target) throw new ClawalkietalkieError(0, 'invalid_address', { address: to })
  return formatAddress(target)
}

export const setStreaming = (wire: Wire, holder: Holder, options: StreamingOptions): Promise<StreamingSetting> => {
  const extra = options.includeStatus === undefined ? {} : { includeStatus: options.includeStatus }
  const json = { instanceId: holder.instanceId, on: options.on, ...extra }
  return request(wire, { method: 'PUT', path: `/v1/sessions/${enc(holder.name)}/streaming`, json })
}

export const postUpdate = (wire: Wire, holder: Holder, text: string): Promise<PostedUpdate> => {
  if (typeof text !== 'string' || text.length < 1 || text.length > MAX_TEXT) throw invalid(`an update is 1–${MAX_TEXT} characters`)
  return request(wire, { method: 'POST', path: '/v1/updates', json: { from: holder.name, instanceId: holder.instanceId, text } })
}

export const readUpdates = (wire: Wire, holder: Holder, query: UpdatesQuery = {}): Promise<UpdatesPage> => {
  const wait = Math.min(MAX_WAIT_S, Math.max(0, query.wait ?? 0))
  const q = { from: holder.name, instanceId: holder.instanceId, after: query.after, wait }
  return request(wire, { method: 'GET', path: '/v1/updates', query: q, signal: query.signal, timeoutMs: wait * 1000 + 15_000 })
}

export const follow = (wire: Wire, holder: Holder, to: string): Promise<{ to: string }> => {
  const json = { from: holder.name, instanceId: holder.instanceId, to: addressOf(to) }
  return request(wire, { method: 'PUT', path: '/v1/follows', json })
}

export const unfollow = async (wire: Wire, holder: Holder, to: string): Promise<void> => {
  const json = { from: holder.name, instanceId: holder.instanceId, to: addressOf(to) }
  await request(wire, { method: 'DELETE', path: '/v1/follows', json })
}

export const following = async (wire: Wire, holder: Holder): Promise<Follow[]> => {
  const query = { from: holder.name, instanceId: holder.instanceId }
  return (await request<{ follows: Follow[] }>(wire, { method: 'GET', path: '/v1/follows', query })).follows
}

export const followers = async (wire: Wire, holder: Holder): Promise<Followers> => {
  const query = { from: holder.name, instanceId: holder.instanceId }
  const page = await request<Partial<Followers>>(wire, { method: 'GET', path: '/v1/followers', query })
  return { followers: page.followers ?? [], blocked: page.blocked ?? [] }
}

// block: true removes the follower and blocks it from following again; false lifts that block.
export const dropFollower = async (wire: Wire, holder: Holder, change: { follower: string, block: boolean }): Promise<void> => {
  const json = { from: holder.name, instanceId: holder.instanceId, follower: addressOf(change.follower) }
  await request(wire, { method: 'DELETE', path: change.block ? '/v1/followers' : '/v1/followers/blocks', json })
}
