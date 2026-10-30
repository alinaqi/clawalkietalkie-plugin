// Sending, receiving and listing.
import { formatAddress, parseAddress, parseTarget, suggestName } from '../../claude-code/hooks/lib/address.ts'
import { formatWho } from '../../claude-code/hooks/lib/frame.ts'
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
  for (const message of taken) s.hops.set(parseAddress(message.from) ?? message.from, message.hop ?? 0)
  if (taken.length > 0) await relayOf(s).ack(s.identity.name, s.identity.instanceId, taken.map((m) => m.id))
  return formatInbox(taken, selfOf(s))
}

const unknown = async (s: AgentState, name: string, typed: string): Promise<string> => {
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

export const send = async (s: AgentState, to: string, text: string): Promise<string> => {
  if (!s.auth) return SIGN_IN
  const target = parseTarget(to)
  if (!target) return `"${to}" is not an address (like cc:happy-dog or cx:review-bot).`
  const address = target.kind ? formatAddress(target.name, target.kind) : target.name
  const { name: from, instanceId } = s.identity
  const res = await relayOf(s).send({ from, instanceId, to: address, text, hop: hopFor(s, target.name) })
  if (res.ok) return `Sent to ${res.value.to ?? formatAddress(target.name, target.kind ?? 'cc')}${res.value.online ? '.' : ' (offline now; delivered within 24 h).'}`
  if (res.status === 404) return unknown(s, target.name, to.trim())
  return res.status === 429 ? 'Not sent: 20 messages in the last minute; wait a moment.' : `Not sent: ${why(res)}.`
}

export const who = async (s: AgentState): Promise<string> => {
  if (!s.auth) return SIGN_IN
  const res = await relayOf(s).list()
  return res.ok ? formatWho(res.value, { self: s.identity.name, now: Date.now() }) : `Could not list agents: ${why(res)}.`
}
