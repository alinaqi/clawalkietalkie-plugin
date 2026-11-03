// Refusals both clients explain the same way: the conversation guard, and a recipient working on another project.

import type { Result } from './relay-core.ts'

type Refused = Extract<Result<unknown>, { ok: false }>

export const CIRCLES = 'Not sent: this exchange is going in circles (too many messages back and forth, or one thread too long). ' +
  'Stop here and ask the user how to go on.'

// Not for that agent: where it works, and which of the person's agents work on the project.
const unrelated = (res: Refused, address: string): string => {
  const suggest = Array.isArray(res.details?.suggest) ? res.details.suggest as string[] : []
  const offer = suggest.length > 0 ? ` Agents on that project: ${suggest.join(', ')}.` : ' None of the user\'s agents works on it now; ask the user.'
  return `Not sent: ${address} works on ${String(res.details?.project ?? 'another project')}.${offer}`
}

// The text for a guard refusal, or null for any other.
export const guardRefusal = (res: Refused, address: string): string | null => {
  if (res.error === 'loop_guard') return CIRCLES
  return res.error === 'unrelated_recipient' ? unrelated(res, address) : null
}

// Shown with every incoming message: how to drop it when it is not about this agent's work.
export const discardHint = (id: string, who: string): string =>
  `If it is not about ${who}'s work, call discard with ids: ["${id}"] and don't act on it or reply.`
