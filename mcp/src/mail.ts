// Sending, receiving and listing.
import { formatAddress, formatTarget, parseTarget, suggestName, type Target } from '../../claude-code/hooks/lib/address.ts'
import { boardUrl, type MessageType, type Result, type Sent } from '../../claude-code/hooks/lib/relay.ts'
import { describeWho, parseStatus, statusText } from '../../claude-code/hooks/lib/who.ts'
import { formatInbox } from './format.ts'
import { relayOf, selfOf, setAuth, SIGN_IN, why, type AgentState } from './state.ts'

// Fetches what waits (long-polling up to `waitSeconds`) into the buffer, once per message.
export const pollOnce = async (s: AgentState, waitSeconds = 0): Promise<void> => {
  if (!s.auth) return
  const res = await relayOf(s).inbox(s.identity.name, s.identity.instanceId, waitSeconds)
  if (!res.ok) {
    if (res.status === 401) setAuth(s, undefined)
    return
  }
  const fresh = res.value.filter((m) => !s.seen.has(m.id))
  for (const message of fresh) s.seen.add(message.id)
  s.buffer.push(...fresh)
}

export const inbox = async (s: AgentState): Promise<string> => {
  if (!s.auth) return SIGN_IN
  await pollOnce(s, 0)
  const taken = s.buffer.splice(0)
  for (const message of taken) s.hops.set(hopKey(parseTarget(message.from)) ?? message.from, message.hop ?? 0)
  if (taken.length > 0) await relayOf(s).ack(s.identity.name, s.identity.instanceId, taken.map((m) => m.id))
  return formatInbox(taken, selfOf(s))
}

// Replies are tracked per sender: name for the user's own agents, name@team for a teammate's.
const hopKey = (target: Target | null): string | null => target && (target.team ? `${target.name}@${target.team}` : target.name)

const addressOf = (target: Target): string => formatAddress(target.name, target.kind ?? 'cc', target.team)

// Did-you-mean only for the user's own agents: a team's names are not theirs to list.
const unknown = async (s: AgentState, target: Target, typed: string): Promise<string> => {
  if (target.team) return `No agent is called ${addressOf(target)}. The who tool lists the agents shared in ${target.team}.`
  const name = target.name
  const listed = await relayOf(s).list()
  const byName = new Map(listed.ok ? listed.value.map((a) => [a.address.slice(3), a.address] as const) : [])
  const close = suggestName(name, [...byName.keys()])
  return `No agent is called ${typed}.${close ? ` Did you mean ${byName.get(close)}?` : ' The who tool lists them.'}`
}

// An answer to the last message read from `name` goes one hop deeper; anything else starts at 0.
const hopFor = (s: AgentState, name: string): number => {
  const answered = s.hops.get(name)
  s.hops.delete(name)
  return answered === undefined ? 0 : answered + 1
}

const sent = (value: Sent, target: Target): string => {
  const to = value.to ?? addressOf(target)
  if (value.delivery === 'held') return `Sent to ${to}; held until its owner approves it.`
  return `Sent to ${to}${value.online ? '.' : ' (offline now; delivered within 24 h).'}`
}

const refused = (s: AgentState, res: Extract<Result<unknown>, { ok: false }>, team: string | null): string => {
  const where = team ?? 'that team'
  if (res.error === 'not_shared') return `Not sent: this agent is not shared in ${where}. Ask the user to share it on the board, ${boardUrl(s.deps.serverUrl)}.`
  if (res.error === 'blocked_by_receiver') return 'Not sent: that agent doesn\'t accept messages from you (its owner\'s setting).'
  if (res.error === 'denied_by_policy') return `Not sent: the policy of ${where} does not allow this message.`
  return res.status === 429 ? 'Not sent: 20 messages in the last minute; wait a moment.' : `Not sent: ${why(res)}.`
}

export interface Outgoing { text: string, type: MessageType }

// type: 'note' informs; 'request' asks the receiver to do something, as its owner's settings allow.
export const send = async (s: AgentState, to: string, out: Outgoing): Promise<string> => {
  if (!s.auth) return SIGN_IN
  const target = parseTarget(to)
  if (!target) return `"${to}" is not an address (like cc:happy-dog, cx:review-bot or cc:api@acme).`
  const { name: from, instanceId } = s.identity
  const res = await relayOf(s).send({ from, instanceId, to: formatTarget(target), ...out, hop: hopFor(s, hopKey(target)!) })
  if (res.ok) return sent(res.value, target)
  return res.status === 404 ? unknown(s, target, to.trim()) : refused(s, res, target.team)
}

export const who = async (s: AgentState): Promise<string> => {
  if (!s.auth) return SIGN_IN
  const res = await describeWho(relayOf(s), { self: s.identity.name, now: Date.now() })
  return res.ok ? res.value : `Could not list agents: ${why(res)}.`
}

export const setStatus = async (s: AgentState, input: Record<string, unknown>): Promise<string> => {
  if (!s.auth) return SIGN_IN
  const status = parseStatus(input)
  if (typeof status === 'string') return `Status not set: ${status}`
  const res = await relayOf(s).setStatus(s.identity.name, { instanceId: s.identity.instanceId, ...status })
  return res.ok ? `Status set: ${statusText(status)}.` : `Status not set: ${why(res)}.`
}
