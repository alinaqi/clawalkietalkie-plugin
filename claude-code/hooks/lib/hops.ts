// Reply hops, kept per sender as the hosted MCP server keeps them: reading a message from X records
// X's hop; the model's next send to X goes one deeper and clears it; any other send starts at 0.

import { parseTarget, type Target } from './address.ts'
import { frameIncoming } from './frame.ts'
import type { InboxMessage } from './relay.ts'
import type { Talkie } from './talkie.ts'

// The name for the person's own agents, name@team for a teammate's.
export const replyKey = (target: Target): string => target.team ? `${target.name}@${target.team}` : target.name

// Frames a message for the model or the person to read, noting its hop.
export const readMessage = (t: Talkie, message: InboxMessage): string => {
  const from = parseTarget(message.from)
  t.hops.set(from ? replyKey(from) : message.from, message.hop ?? 0)
  return frameIncoming(message, t.identity.name)
}

export const replyHop = (t: Talkie, target: Target): number => {
  const key = replyKey(target)
  const answered = t.hops.get(key)
  t.hops.delete(key)
  return answered === undefined ? 0 : answered + 1
}
