// Update streams (§3h): the streaming switch, posting, the feed, follows and followers. Every call names this
// agent (from) and its instance, which the relay checks holds the name.

import { enc, pick, type Call } from './relay-core.ts'
import type { Follow, Followers, Streaming, UpdatesPage, UpdatesQuery } from './relay-types.ts'

export interface AgentRef { from: string, instanceId: string }
export interface StreamBody { instanceId: string, on: boolean, includeStatus?: boolean }

const agentQuery = (agent: AgentRef): string => `from=${enc(agent.from)}&instanceId=${enc(agent.instanceId)}`

const updatesPath = (from: string, query: UpdatesQuery): string =>
  `/v1/updates?${agentQuery({ from, instanceId: query.instanceId })}&wait=${query.wait}${query.after ? `&after=${enc(query.after)}` : ''}`

export const updateCalls = (call: Call) => ({
  setStreaming: (name: string, body: StreamBody) => call<Streaming>('PUT', `/v1/sessions/${enc(name)}/streaming`, body),
  postUpdate: (agent: AgentRef, text: string) => call<{ id: number }>('POST', '/v1/updates', { ...agent, text }),
  // The followed agents' updates after the cursor, oldest first; with wait, long-polls until one posts.
  updates: (from: string, query: UpdatesQuery) => call<UpdatesPage>('GET', updatesPath(from, query)),
  follow: (agent: AgentRef, to: string) => call<{ to: string }>('PUT', '/v1/follows', { ...agent, to }),
  unfollow: (agent: AgentRef, to: string) => call<object>('DELETE', '/v1/follows', { ...agent, to }),
  follows: (agent: AgentRef) => pick<Follow[]>(call('GET', `/v1/follows?${agentQuery(agent)}`), 'follows'),
  followers: (agent: AgentRef) => call<Followers>('GET', `/v1/followers?${agentQuery(agent)}`),
  // Removes a follower and blocks it from following again; unblockFollower lets it.
  removeFollower: (agent: AgentRef, follower: string) => call<object>('DELETE', '/v1/followers', { ...agent, follower }),
  unblockFollower: (agent: AgentRef, follower: string) => call<object>('DELETE', '/v1/followers/blocks', { ...agent, follower })
})
