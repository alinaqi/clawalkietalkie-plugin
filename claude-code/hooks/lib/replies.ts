// Automatic replies: when a turn that an incoming request started ends, its final answer goes back to the
// request's sender as a note threaded under the request (replyTo), once, with an Idempotency-Key derived from
// the request's id so a retry never sends it twice. The engine hands the turn's final text on turn.complete
// (`answer`); a turn that ends with none sends a short done note, and an interrupted one sends nothing.

import type { EngineInterface, TurnCompleteInput, TurnStartInput } from 'claude-code'
import type { Box, On } from './lifecycle.ts'
import type { InboxMessage } from './relay.ts'
import { sendMessage } from './send.ts'
import type { Talkie } from './talkie.ts'

export const DONE = 'Done: finished the request'

export const replyKeyOf = (message: InboxMessage): string => `reply-${message.id}`

// The main loop's turn that begins with a request's prompt answers that request.
export const claimTurn = (t: Talkie, e: TurnStartInput): void => {
  if (e.agentId !== undefined) return
  const at = t.awaiting.findIndex((a) => e.text.includes(a.text))
  if (at < 0) return
  t.turns.set(e.turnId, t.awaiting[at]!.message)
  t.awaiting.splice(at, 1)
}

export async function answerTurn ($: EngineInterface, t: Talkie, e: TurnCompleteInput): Promise<void> {
  const message = e.agentId === undefined ? t.turns.get(e.turnId) : undefined
  if (!message) return
  t.turns.delete(e.turnId)
  if (e.isAborted || t.replied.has(message.id)) return
  t.replied.add(message.id)
  const text = e.answer.trim() || DONE
  await sendMessage($, t, { to: message.from, text, isAnswer: true, type: 'note', replyTo: message.id, key: replyKeyOf(message) })
}

export function onTurns (on: On, box: Box): void {
  on('turn.start', ($, e, next) => {
    if (box.talkie) claimTurn(box.talkie, e)
    return next(e)
  }).catch(($, e, next) => next(e))
  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    if (box.talkie) await answerTurn($, box.talkie, e).catch(() => {})
    return done
  })
}
