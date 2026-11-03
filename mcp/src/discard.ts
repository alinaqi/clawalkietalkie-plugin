// Discarding: messages the inbox showed that are not about this agent's work; their senders see them as discarded.
import { relayOf, SIGN_IN, why, type AgentState } from './state.ts'

export const discard = async (s: AgentState, ids: readonly string[]): Promise<string> => {
  if (!s.auth) return SIGN_IN
  if (ids.length === 0) return 'Nothing discarded: give the ids of the messages, as the inbox shows them.'
  const res = await relayOf(s).discard(s.identity.name, s.identity.instanceId, ids)
  if (!res.ok) return `Not discarded: ${why(res)}.`
  return `Discarded ${ids.length} message${ids.length === 1 ? '' : 's'}; their senders see them as discarded. Don't act on or reply to them.`
}
