// Discarding: messages this session received that are not about its work leave its inbox, their senders see
// them as discarded, and a request among them gets no automatic reply.

import type { EngineInterface } from 'claude-code'
import { SIGN_IN, why } from './actions.ts'
import { relayOf, type Talkie } from './talkie.ts'

const MAX_IDS = 100

// The ids the model passed: strings only, at most 100.
export const idsOf = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string' && id !== '').slice(0, MAX_IDS) : []

export async function discardMessages ($: EngineInterface, t: Talkie, ids: readonly string[]): Promise<string> {
  if (!t.auth) return SIGN_IN
  if (ids.length === 0) return 'Nothing discarded: give the ids of the messages, as their frame shows them.'
  const res = await relayOf($, t).discard(t.identity.name, t.identity.instanceId, ids)
  if (!res.ok) return `Not discarded: ${why(res)}.`
  for (const id of ids) t.replied.add(id)
  return `Discarded ${ids.length} message${ids.length === 1 ? '' : 's'}; their senders see them as discarded. Don't act on or reply to them.`
}
