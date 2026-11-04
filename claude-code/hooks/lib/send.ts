// Sending: to the person's own agents by name, or to a teammate's by name@team.

import type { EngineInterface } from 'claude-code'
import { formatAddress, formatTarget, parseTarget, suggestName, type Target } from './address.ts'
import { SIGN_IN, why } from './actions.ts'
import { replyHop } from './hops.ts'
import { guardRefusal } from './refusals.ts'
import type { MessageType, Result, SendBody, Sent } from './relay.ts'
import { relayOf, type Talkie } from './talkie.ts'

// isAnswer: the model's send, which may answer what it read; the person's own sends start a fresh chain.
// type: 'note' (the default) informs; 'request' asks the receiver to do something.
// replyTo: the id of the received message this answers. key: an Idempotency-Key, so a retry never sends twice.
// about: the project the message concerns, so the relay refuses it for an agent on another.
export interface Outgoing { to: string, text: string, isAnswer: boolean, type?: string, replyTo?: string, key?: string, about?: string }

// A send with a key is retried at once when the relay is unreachable or failing; the key makes that safe.
const ATTEMPTS = 3
const isTransient = (res: Result<unknown>): boolean => !res.ok && (res.status === 0 || res.status >= 500)

export const BLOCKED = 'Not sent: that agent doesn\'t accept messages from you (its owner\'s setting).'

const isMessageType = (type: string): type is MessageType => type === 'note' || type === 'request'

const addressOf = (target: Target): string => formatAddress(target.name, target.kind ?? 'cc', target.team)

const sent = (value: Sent, target: Target): string => {
  const to = value.to ?? addressOf(target)
  if (value.delivery === 'held') return `Sent to ${to}; held until its owner approves it.`
  const emailed = value.ownerNotified ? ' Its owner was emailed so they can bring it back.' : ''
  if (value.closed) return `Sent, but ${to} has closed (its session ended); it gets this if it resumes within 24 h.${emailed}`
  return `Sent to ${to}${value.online ? '.' : ' (offline now; delivered when it is back, within 24 h).'}${emailed}`
}

const refused = (res: Extract<Result<unknown>, { ok: false }>, target: Target, replyTo?: string): string => {
  if (res.error === 'invalid_reply_to') return `Not sent: ${replyTo ?? 'that id'} is not a message this session received from ${addressOf(target)}.`
  if (res.error === 'not_shared') return `Not sent: this session is not shared in ${target.team ?? 'that team'}. Run /talkie share ${target.team ?? '<team>'} first.`
  if (res.error === 'blocked_by_receiver') return BLOCKED
  const guard = guardRefusal(res, addressOf(target))
  if (guard) return guard
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
  const extra = { ...(out.replyTo ? { replyTo: out.replyTo } : {}), ...(out.about ? { about: out.about } : {}) }
  const res = await post($, t, { body: { from, instanceId, to: formatTarget(target), text: out.text, hop, type, ...extra }, key: out.key })
  if (res.ok && out.replyTo) t.replied.add(out.replyTo)
  if (res.ok) return sent(res.value, target)
  if (res.status === 404) return unknown($, t, target)
  return refused(res, target, out.replyTo)
}

async function post ($: EngineInterface, t: Talkie, send: { body: SendBody, key?: string }): Promise<Result<Sent>> {
  const relay = relayOf($, t, send.key ? { 'idempotency-key': send.key } : undefined)
  let res = await relay.send(send.body)
  for (let attempt = 1; send.key && attempt < ATTEMPTS && isTransient(res); attempt++) res = await relay.send(send.body)
  return res
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
