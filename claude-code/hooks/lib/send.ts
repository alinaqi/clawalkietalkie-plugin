// Sending: to the person's own agents by name, or to a teammate's by name@team.

import type { EngineInterface } from 'claude-code'
import { formatAddress, formatTarget, parseTarget, suggestName, type Target } from './address.ts'
import { SIGN_IN, why } from './actions.ts'
import { replyHop } from './hops.ts'
import type { MessageType, Result, Sent } from './relay.ts'
import { relayOf, type Talkie } from './talkie.ts'

// isAnswer: the model's send, which may answer what it read; the person's own sends start a fresh chain.
// type: 'note' (the default) informs; 'request' asks the receiver to do something.
export interface Outgoing { to: string, text: string, isAnswer: boolean, type?: string }

export const BLOCKED = 'Not sent: that agent doesn\'t accept messages from you (its owner\'s setting).'

const isMessageType = (type: string): type is MessageType => type === 'note' || type === 'request'

const addressOf = (target: Target): string => formatAddress(target.name, target.kind ?? 'cc', target.team)

const sent = (value: Sent, target: Target): string => {
  const to = value.to ?? addressOf(target)
  if (value.delivery === 'held') return `Sent to ${to}; held until its owner approves it.`
  return `Sent to ${to}${value.online ? '.' : ' (offline now; delivered when it is back, within 24 h).'}`
}

const refused = (res: Extract<Result<unknown>, { ok: false }>, target: Target): string => {
  if (res.error === 'not_shared') return `Not sent: this session is not shared in ${target.team ?? 'that team'}. Run /talkie share ${target.team ?? '<team>'} first.`
  if (res.error === 'blocked_by_receiver') return BLOCKED
  if (res.error === 'denied_by_policy') return `Not sent: the policy of ${target.team ?? 'that team'} does not allow this message.`
  if (res.status === 429) return 'Not sent: this session sent 20 messages in the last minute; wait a moment.'
  return `Not sent: ${why(res)}.`
}

export async function sendMessage ($: EngineInterface, t: Talkie, out: Outgoing): Promise<string> {
  if (!t.auth) return SIGN_IN
  const target = parseTarget(out.to)
  if (!target) return `"${out.to}" is not an address (like cc:happy-dog, cx:review-bot or cc:api@acme).`
  const type = out.type ?? 'note'
  if (!isMessageType(type)) return 'Not sent: the type is note or request.'
  const { name: from, instanceId } = t.identity
  const hop = out.isAnswer ? replyHop(t, target) : 0
  const res = await relayOf($, t).send({ from, instanceId, to: formatTarget(target), text: out.text, hop, type })
  if (res.ok) return sent(res.value, target)
  if (res.status === 404) return unknown($, t, target)
  return refused(res, target)
}

// Did-you-mean only for the person's own sessions: a team's names are not theirs to list here.
async function unknown ($: EngineInterface, t: Talkie, target: Target): Promise<string> {
  if (target.team) return `No agent is called ${addressOf(target)}. /talkie who lists the agents shared in ${target.team}.`
  const listed = await relayOf($, t).list()
  const byName = new Map(listed.ok ? listed.value.map((s) => [s.address.slice(3), s.address] as const) : [])
  const close = suggestName(target.name, [...byName.keys()])
  const hint = close ? ` Did you mean ${byName.get(close)}?` : ' /talkie who lists them.'
  return `No session is called ${addressOf(target)}.${hint}`
}
