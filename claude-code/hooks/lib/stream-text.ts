// What the update-stream tools answer, and their refusals in plain sentences, worded the same by the mod and the
// MCP server (which bundles this file). self: "this session" in the mod, "this agent" in the MCP server.

import type { Result } from './relay-core.ts'
import type { Follow, Followers, Streaming } from './relay-types.ts'

type Refused = Extract<Result<unknown>, { ok: false }>

export const MAX_UPDATE_CHARS = 2000
export const TOO_LONG = `Not posted: an update is 1–${MAX_UPDATE_CHARS} characters.`

const relayWhy = (res: Refused): string =>
  res.status === 0 ? 'the relay server is unreachable' : `the relay answered ${res.status} ${res.error}`

const teamOf = (address: string): string => address.includes('@') ? address.split('@')[1]! : 'that team'

const message = (res: Refused): string | null => typeof res.details?.message === 'string' ? res.details.message : null

const followWhy = (res: Refused, address: string, self: string): string => {
  switch (res.error) {
    case 'invalid_request': return 'an agent cannot follow itself.'
    case 'unknown_address': return `no agent is called ${address} (who lists them; a teammate's agent is name@team).`
    case 'not_shared': return `${self} is not shared in ${teamOf(address)}, so it cannot follow agents there. The user can share it.`
    case 'denied_by_policy': return `the policy of ${teamOf(address)} does not allow updates from ${address}.`
    case 'blocked_by_publisher': return `${address} removed ${self} from its followers, so it cannot follow it again unless ${address} unblocks it.`
    case 'not_allowed_for_assistant': return message(res) ?? `${address} is outside what the user lets assistants reach.`
    case 'not_streaming': return `${address} is not streaming updates; it (or its owner) has to turn streaming on first.`
    case 'follow_limit': return `at most ${String(res.details?.max ?? 'so many')} follows per agent (and 100 followers per agent); unfollow one first.`
    case 'rate_limited': return 'too many follow changes in the last hour (30 at most); try again later.'
    default: return `${relayWhy(res)}.`
  }
}

export const followRefusal = (res: Refused, address: string, self: string): string =>
  `Not following: ${followWhy(res, address, self)}`

export const unfollowRefusal = (res: Refused): string =>
  res.status === 429 ? 'Not changed: too many follow changes in the last hour (30 at most); try again later.' : `Not changed: ${relayWhy(res)}.`

export const postRefusal = (res: Refused, self: string): string => {
  if (res.error === 'not_streaming') return `Not posted: ${self} is not streaming. Turn it on with stream_updates first (only if the user wants it).`
  if (res.status === 429) return 'Not posted: at most 60 updates an hour per agent; try again later.'
  return res.status === 400 ? TOO_LONG : `Not posted: ${relayWhy(res)}.`
}

export const streamingText = (state: Streaming, address: string): string => state.on
  ? `Streaming on for ${address}${state.includeStatus ? ' (with status changes)' : ''}. Post with post_update; the agents following it read them, as information only.`
  : `Streaming off for ${address}: nothing is published, and its follows stay, to resume when it is on again.`

export const streamRefusal = (res: Refused): string => `Streaming not changed: ${relayWhy(res)}.`

export const followingText = (follows: readonly Follow[], self: string): string => {
  if (follows.length === 0) return `${self[0]!.toUpperCase()}${self.slice(1)} follows no agents. follow adds one that streams.`
  const lines = follows.map((f) => `- ${f.to}${f.active ? '' : ' (paused: not streaming or out of reach)'}`)
  return [`${self[0]!.toUpperCase()}${self.slice(1)} follows:`, ...lines].join('\n')
}

export const followersText = (list: Followers, address: string): string => {
  const followers = list.followers.length > 0 ? list.followers.map((f) => `- ${f.address}`) : ['(none)']
  const blocked = list.blocked?.length ? ['', 'Removed (cannot follow again):', ...list.blocked.map((f) => `- ${f.address}`)] : []
  return [`Followers of ${address}:`, ...followers, ...blocked].join('\n')
}

export const listRefusal = (res: Refused): string => `Could not list them: ${relayWhy(res)}.`
